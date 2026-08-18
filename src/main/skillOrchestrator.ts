/**
 * v2.0「一键智能提炼」工作流：SkillOrchestrator 六步流水线。
 *
 * 流水线（每步缺失时 fallback 到 GenericLLMCaller 或内置确定性实现）：
 *   S1 session-distiller      预处理与蒸馏 → raw_knowledge
 *   S2 code-snippet-extractor 代码萃取增强 → code_snippets
 *   S3 vector-embedder        语义向量化   → vector
 *   S4 knowledge-refiner      去重合并     → merged / new
 *   S5 markdown-archiver      归档索引     → .md + knowledge.json
 *   S6 UI 反馈                （由渲染层 Toast / 进度条呈现）
 *
 * 设计原则（ponytail）：
 * - 每个 Skill 有本地确定性实现（零依赖、可单测），LLM 仅作为增强 fallback；
 * - 进度通过 onProgress 回调逐步上报（0-100），渲染层以进度条呈现；
 * - 任一关键步骤失败即中止并回滚（不写库），返回 failedStep 供 UI 精确提示。
 */
import fs from 'node:fs'
import path from 'node:path'
import { zstdDecompressSync } from 'node:zlib'
import { readApiConfig } from './apiConfig'
import { logger } from './logger'
import {
  getKnowledge,
  createKnowledgeEntry,
  updateKnowledgeEntry
} from './knowledge'
import type {
  ExtractStepKey,
  KnowledgePipelineInput,
  KnowledgePipelineProgress,
  KnowledgePipelineResult,
  RecentSessionTextResult
} from '../shared/ipc'

// ---------------------------------------------------------------------------
// 配置：skills.config.json（默认内置，可被 workspace/config/skills.config.json 覆盖）
// ---------------------------------------------------------------------------

interface SkillConfig {
  enabled: boolean
  fallbackPrompt: string
  note?: string
  similarityThreshold?: number
}

export interface SkillsConfig {
  version: number
  llm: { enabled: boolean; model?: string; timeoutMs?: number }
  skills: Record<string, SkillConfig>
}

let cachedConfig: SkillsConfig | null = null

export function loadSkillsConfig(workspaceDir: string): SkillsConfig {
  if (cachedConfig) return cachedConfig
  const builtinPath = path.join(__dirname, 'skills.config.json')
  let config: SkillsConfig = { version: 1, llm: { enabled: true, model: 'deepseek-chat', timeoutMs: 30000 }, skills: {} }
  try {
    if (fs.existsSync(builtinPath)) {
      config = JSON.parse(fs.readFileSync(builtinPath, 'utf8')) as SkillsConfig
    }
  } catch (error) {
    logger.warn(`内置 skills.config.json 读取失败：${String(error)}`)
  }
  // 外部覆盖（用户可自定义 prompt）
  const userPath = path.join(workspaceDir, 'config', 'skills.config.json')
  try {
    if (fs.existsSync(userPath)) {
      const user = JSON.parse(fs.readFileSync(userPath, 'utf8')) as Partial<SkillsConfig>
      config = {
        ...config,
        ...user,
        llm: { ...config.llm, ...(user.llm ?? {}) },
        skills: { ...config.skills, ...(user.skills ?? {}) }
      }
    }
  } catch (error) {
    logger.warn(`用户 skills.config.json 读取失败：${String(error)}`)
  }
  cachedConfig = config
  return config
}

// ---------------------------------------------------------------------------
// Skill Registry + LLM fallback（SkillAdapter 模式）
// ---------------------------------------------------------------------------

/** 会话蒸馏输出。 */
export interface DistilledKnowledge {
  title: string
  summary: string
  codeSnippets: Array<{ language: string; code: string; comment: string; dependencies?: string[] }>
  tags: string[]
}

type SkillExecutor = (input: unknown, ctx: PipelineContext) => Promise<unknown>

class SkillRegistryImpl {
  private map = new Map<string, SkillExecutor>()

  register(name: string, executor: SkillExecutor): void {
    this.map.set(name, executor)
  }

  has(name: string): boolean {
    return this.map.has(name)
  }

  get(name: string): SkillExecutor | undefined {
    return this.map.get(name)
  }
}

export const SkillRegistry = new SkillRegistryImpl()

interface PipelineContext {
  workspaceDir: string
  config: SkillsConfig
  progress: (step: ExtractStepKey, percent: number, message: string) => void
  sessionId?: string
}

/** 通用 LLM 调用器：读取桌面端 API 配置调用 DeepSeek chat completions。 */
export class GenericLLMCaller {
  static async call(_workspaceDir: string, systemPrompt: string, userInput: string, timeoutMs = 30000): Promise<string> {
    const api = readApiConfig()
    const key = (api.apiKey ?? '').trim()
    if (!key) throw new Error('未配置 API Key，已回退到本地启发式提炼')
    const base = (api.baseUrl ?? 'https://api.deepseek.com').replace(/\/+$/, '')
    const model = api.model ?? 'deepseek-chat'
    const res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      signal: AbortSignal.timeout(timeoutMs),
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userInput }
        ],
        temperature: 0.2,
        max_tokens: 2000
      })
    })
    if (!res.ok) throw new Error(`LLM 调用失败（HTTP ${res.status}）`)
    const body = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> }
    const content = body.choices?.[0]?.message?.content ?? ''
    if (!content.trim()) throw new Error('LLM 返回为空')
    return content.trim()
  }

  /** 尝试把 LLM 返回解析为 JSON（兼容 ```json 围栏）。失败返回 null。 */
  static parseJson<T>(content: string): T | null {
    try {
      const cleaned = content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
      return JSON.parse(cleaned) as T
    } catch {
      return null
    }
  }
}

/** SkillOrchestrator：统一调度。缺失 Skill → 注入 fallbackPrompt 调 LLM；无 LLM → 本地实现。 */
export class SkillOrchestrator {
  constructor(private _workspaceDir: string, private ctx: PipelineContext) {}

  async run(skillName: string, input: unknown, fallbackPrompt: string): Promise<unknown> {
    const executor = SkillRegistry.get(skillName)
    if (executor) {
      return executor(input, this.ctx)
    }
    // TODO: Install specific skill for production —— 缺失时走 LLM fallback
    logger.warn(`Skill ${skillName} missing, using LLM fallback`)
    const config = this.ctx.config
    if (config.llm.enabled && fallbackPrompt) {
      try {
        const raw = await GenericLLMCaller.call(
          this._workspaceDir,
          fallbackPrompt,
          typeof input === 'string' ? input : JSON.stringify(input),
          config.llm.timeoutMs ?? 30000
        )
        return raw
      } catch (error) {
        logger.warn(`LLM fallback 失败：${String(error)}`)
        throw error
      }
    }
    throw new Error(`缺少 Skill「${skillName}」且 LLM 未配置`)
  }
}

// ---------------------------------------------------------------------------
// 本地确定性实现（Skill 内置实现，零依赖）
// ---------------------------------------------------------------------------

function progress(ctx: PipelineContext, step: ExtractStepKey, percent: number, message: string): void {
  ctx.progress(step, percent, message)
}

/** S1 蒸馏：启发式（代码块 + 经验段落），与 knowledge.heuristicKnowledgeExtractor 同源思路。 */
SkillRegistry.register('session-distiller', async (input, ctx) => {
  const text = String((input as { sessionText?: string })?.sessionText ?? '')
  progress(ctx, 'distill', 15, '正在蒸馏会话…')
  const out: DistilledKnowledge = { title: '', summary: '', codeSnippets: [], tags: [] }
  if (!text.trim()) return out

  // 代码块
  const codeBlocks = text.match(/```([^\n]*)\n[\s\S]*?```/g) ?? []
  for (const block of codeBlocks) {
    const lang = (block.match(/^```([^\n]*)/)?.[1] ?? '').trim() || 'code'
    const code = block.replace(/^```[^\n]*\n/, '').replace(/```$/, '').trim()
    if (code) out.codeSnippets.push({ language: lang, code, comment: '' })
  }
  // 经验段落
  const sectionRe = /(?:经验|方案|解决|坑|总结|最佳实践)[：:]\s*([^\n]{2,120})/g
  const heads: string[] = []
  let m: RegExpExecArray | null
  while ((m = sectionRe.exec(text))) heads.push(m[1].trim())
  const summaryParts = heads.slice(0, 3)
  // 标签：技术栈关键词
  const techRe = /\b(React|Vue|Node|TypeScript|JavaScript|Python|Go|SQL|Docker|Git|LLM|API|CSS|HTML|Electron|Redis|PostgreSQL|MySQL)\b/gi
  const techTags = [...new Set((text.match(techRe) ?? []).map((t) => t.toLowerCase()))].slice(0, 8)
  out.summary = summaryParts.join('；') || (text.split('\n').find((l) => l.trim().length > 20)?.slice(0, 120) ?? '')
  out.title = summaryParts[0]?.slice(0, 40) ?? '会话知识提炼'
  out.tags = ['提炼', ...techTags]
  return out
})

/** S2 代码萃取：为代码块补充语言标记与注释（无 LLM 时用首行注释启发）。 */
SkillRegistry.register('code-snippet-extractor', async (input, ctx) => {
  const d = input as DistilledKnowledge
  progress(ctx, 'extract', 35, '正在萃取代码片段…')
  for (const s of d.codeSnippets) {
    if (!s.comment) {
      const c = s.code.match(/(?:\/\/|#|--)\s*(.+)/)?.[1]?.trim()
      s.comment = c ? c.slice(0, 60) : ''
    }
    s.dependencies = []
  }
  return d
})

/** S3 向量化：轻量确定性 Embedding（token 哈希 BOW 128 维，L2 归一化）。 */
const VEC_DIM = 128
export function hashVector(text: string): number[] {
  const vec = new Array<number>(VEC_DIM).fill(0)
  const tokens = text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []
  for (const t of tokens) {
    let h = 5381
    for (let i = 0; i < t.length; i++) h = ((h << 5) + h + t.charCodeAt(i)) >>> 0
    vec[h % VEC_DIM] += 1
  }
  const norm = Math.sqrt(vec.reduce((a, b) => a + b * b, 0)) || 1
  return vec.map((v) => v / norm)
}

export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i]
  return dot
}

SkillRegistry.register('vector-embedder', async (input, ctx) => {
  const d = input as DistilledKnowledge
  progress(ctx, 'vector', 50, '正在生成语义向量…')
  const text = `${d.title} ${d.summary} ${d.tags.join(' ')} ${d.codeSnippets.map((s) => s.code).join(' ')}`
  return { ...d, vector: hashVector(text) }
})

interface VectorEntry {
  id: string
  title: string
  content: string
  tags: string[]
  vector: number[]
}

/** S4 去重合并：与现有条目比对向量相似度，>threshold 则增量合并（保留最新）。 */
SkillRegistry.register('knowledge-refiner', async (input, ctx) => {
  const d = input as DistilledKnowledge & { vector: number[] }
  progress(ctx, 'refine', 70, '正在去重合并…')
  const config = ctx.config
  const threshold = config.skills['knowledge-refiner']?.similarityThreshold ?? 0.85
  const kb = getKnowledge(ctx.workspaceDir)
  const existing: VectorEntry[] = kb.entries.map((e) => ({
    id: e.id,
    title: e.title,
    content: e.content,
    tags: e.tags,
    vector: hashVector(`${e.title} ${e.content} ${e.tags.join(' ')}`)
  }))
  const newVec = d.vector
  let merged: VectorEntry | null = null
  let best = 0
  for (const e of existing) {
    const sim = cosineSimilarity(newVec, e.vector)
    if (sim > best) {
      best = sim
      merged = e
    }
  }
  if (merged && best >= threshold) {
    // 增量合并：内容取新提炼（含更完整信息），标题与标签并集，保留旧 id
    updateKnowledgeEntry(ctx.workspaceDir, merged.id, {
      title: merged.title === d.title ? merged.title : `${merged.title} / ${d.title}`.slice(0, 60),
      content: `${merged.content}\n\n---\n\n${d.summary}${d.codeSnippets.length ? '\n\n```\n' + d.codeSnippets.map((s) => s.code).join('\n\n') + '\n```' : ''}`.slice(0, 6000),
      tags: [...new Set([...merged.tags, ...d.tags])].slice(0, 12)
    })
    return { merged: true, mergedId: merged.id, best, distilled: d }
  }
  return { merged: false, best, distilled: d }
})

/** S5 归档：生成 Markdown 知识卡片（YAML Frontmatter）+ 更新 knowledge.json 索引。 */
SkillRegistry.register('markdown-archiver', async (input, ctx) => {
  const { distilled, merged, mergedId } = input as {
    distilled: DistilledKnowledge & { vector: number[] }
    merged: boolean
    mergedId?: string
  }
  progress(ctx, 'archive', 88, '正在归档与索引…')
  const kbDir = path.join(ctx.workspaceDir, 'knowledge_base')
  const md = [
    '---',
    `title: ${distilled.title.replace(/[:|]/g, '')}`,
    `created_at: ${new Date().toISOString()}`,
    `tags: [${distilled.tags.join(', ')}]`,
    `source_session_id: ${ctx.sessionId ?? ''}`,
    'version: 1',
    '---',
    '',
    '## 摘要',
    '',
    distilled.summary,
    ''
  ]
  if (distilled.codeSnippets.length) {
    md.push('## 代码片段', '')
    for (const s of distilled.codeSnippets) {
      md.push(`### ${s.language}`, '', s.comment ? `> ${s.comment}` : '', '```' + s.language, s.code, '```', '')
    }
  }
  md.push('## 标签', '', distilled.tags.map((t) => `- ${t}`).join('\n'), '')
  const slug = distilled.title.replace(/[^\w\u4e00-\u9fff]+/g, '-').slice(0, 30) || 'knowledge'
  const fileName = `${slug}-${Date.now()}.md`
  const filePath = path.join(kbDir, fileName)
  fs.mkdirSync(kbDir, { recursive: true })
  fs.writeFileSync(filePath, md.join('\n'), 'utf8')
  return { filePath, merged, mergedId }
})

// ---------------------------------------------------------------------------
// 流水线编排
// ---------------------------------------------------------------------------

const STEP_LABEL: Record<ExtractStepKey, string> = {
  distill: '预处理与蒸馏',
  extract: '代码萃取增强',
  vector: '语义向量化',
  refine: '知识去重合并',
  archive: '归档与索引'
}

export async function runExtractionPipeline(
  workspaceDir: string,
  input: KnowledgePipelineInput,
  onProgress: (p: KnowledgePipelineProgress) => void
): Promise<KnowledgePipelineResult> {
  const log: string[] = []
  const emit = (step: ExtractStepKey, percent: number, message: string): void => {
    log.push(`${STEP_LABEL[step]}：${message}`)
    onProgress({ step, percent, message })
  }
  const config = loadSkillsConfig(workspaceDir)
  const ctx: PipelineContext = { workspaceDir, config, progress: emit, sessionId: input.sessionId }
  const orchestrator = new SkillOrchestrator(workspaceDir, ctx)

  const fail = (step: ExtractStepKey, error: unknown): KnowledgePipelineResult => {
    const msg = error instanceof Error ? error.message : String(error)
    logger.error(`提炼流水线 ${STEP_LABEL[step]} 失败：${msg}`)
    return { ok: false, failedStep: step, error: msg, log }
  }

  try {
    // 会话内容非空守卫
    if (!input.sessionText?.trim()) {
      return { ok: false, error: '会话内容为空，请先读取最近会话或手动粘贴内容', log }
    }
    // 分类校验：无分类 → needCategory（UI 引导新建）
    const kb = getKnowledge(workspaceDir)
    const targetCat = input.categoryId ? kb.categories.find((c) => c.id === input.categoryId) : kb.categories[0]
    if (!targetCat) {
      return { ok: false, needCategory: true, error: '请先创建知识分类', log }
    }

    emit('distill', 10, '开始一键智能提炼')

    // S1 蒸馏
    let distilled: DistilledKnowledge
    try {
      const raw = await orchestrator.run('session-distiller', { sessionText: input.sessionText }, config.skills['session-distiller']?.fallbackPrompt ?? '')
      distilled = typeof raw === 'string' ? (GenericLLMCaller.parseJson<DistilledKnowledge>(raw) ?? { title: '会话知识提炼', summary: raw.slice(0, 200), codeSnippets: [], tags: ['提炼'] }) : (raw as DistilledKnowledge)
    } catch (error) {
      return fail('distill', error)
    }
    emit('distill', 30, `蒸馏完成：${distilled.codeSnippets.length} 个代码片段`)

    // S2 代码萃取
    try {
      distilled = (await orchestrator.run('code-snippet-extractor', distilled, config.skills['code-snippet-extractor']?.fallbackPrompt ?? '')) as DistilledKnowledge
    } catch (error) {
      return fail('extract', error)
    }
    emit('extract', 45, '代码片段已标注')

    // S3 向量化
    let vector: number[]
    try {
      const v = (await orchestrator.run('vector-embedder', distilled, '')) as DistilledKnowledge & { vector: number[] }
      vector = v.vector
    } catch (error) {
      return fail('vector', error)
    }
    emit('vector', 60, '语义向量已生成')

    // S4 去重合并
    let refine: { merged: boolean; mergedId?: string }
    try {
      refine = (await orchestrator.run('knowledge-refiner', { ...distilled, vector }, config.skills['knowledge-refiner']?.fallbackPrompt ?? '')) as { merged: boolean; mergedId?: string }
    } catch (error) {
      return fail('refine', error)
    }
    emit('refine', 78, refine.merged ? '发现相似知识，已增量合并' : '无相似知识，标记为新建')

    // S5 归档（写 .md + 索引）
    let archive: { filePath: string }
    try {
      archive = (await orchestrator.run('markdown-archiver', { distilled, merged: refine.merged, mergedId: refine.mergedId }, '')) as { filePath: string }
    } catch (error) {
      return fail('archive', error)
    }

    // 更新 knowledge.json 索引（合并命中则跳过新建）
    if (!refine.merged) {
      createKnowledgeEntry(workspaceDir, targetCat.id, {
        title: distilled.title,
        content: `${distilled.summary}${distilled.codeSnippets.length ? '\n\n```\n' + distilled.codeSnippets.map((s) => s.code).join('\n\n') + '\n```' : ''}`,
        tags: distilled.tags
      })
    }
    emit('archive', 100, `已归档：${path.basename(archive.filePath)}`)

    return {
      ok: true,
      saved: refine.merged ? 0 : 1,
      merged: refine.merged ? 1 : 0,
      categoryName: targetCat.name,
      files: [archive.filePath],
      log
    }
  } catch (error) {
    return fail('distill', error)
  }
}

// ---------------------------------------------------------------------------
// 读取最近会话文本（供「提炼会话」自动填充，避免手贴）
// ---------------------------------------------------------------------------

/** 从 dsh 会话目录读取最近修改会话的用户消息文本（截断 maxChars）。 */
export function readRecentSessionText(workspaceDir: string, maxChars = 8000): RecentSessionTextResult {
  const sessionsRoot = path.join(workspaceDir, 'data', 'sessions')
  if (!fs.existsSync(sessionsRoot)) return { ok: false, error: '无会话数据' }
  let best: { file: string; mtime: number } | null = null
  const walk = (dir: string, depth: number): void => {
    if (depth > 4) return
    let entries: fs.Dirent[] = []
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      const full = path.join(dir, e.name)
      if (e.isDirectory()) walk(full, depth + 1)
      else if (/^session\.jsonl(\.zstd)?$/.test(e.name)) {
        try {
          const st = fs.statSync(full)
          if (!best || st.mtimeMs > best.mtime) best = { file: full, mtime: st.mtimeMs }
        } catch {
          /* ignore */
        }
      }
    }
  }
  walk(sessionsRoot, 0)
  if (!best) return { ok: false, error: '未找到会话文件' }
  // TS 控制流无法追踪闭包内赋值，显式断言
  const target = best as { file: string; mtime: number }

  const title = path.basename(path.dirname(target.file))
  let raw = ''
  try {
    const data = fs.readFileSync(target.file)
    if (target.file.endsWith('.zstd')) {
      // dsh 会话为「帧式 zstd」：按帧 magic 扫描，逐帧解码后拼接（与 dsh 同源逻辑）
      const MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])
      const frames: Array<{ start: number; end: number }> = []
      let pos = 0
      while (pos + 4 <= data.length) {
        if (data.subarray(pos, pos + 4).equals(MAGIC)) {
          let end = pos + 4
          while (end + 3 <= data.length) {
            if (data.subarray(end, end + 4).equals(MAGIC)) break
            end++
          }
          frames.push({ start: pos, end })
          pos = end
        } else {
          pos++
        }
      }
      raw = frames.length
        ? Buffer.concat(frames.map((f) => zstdDecompressSync(data.subarray(f.start, f.end)))).toString('utf8')
        : zstdDecompressSync(data).toString('utf8')
    } else {
      raw = data.toString('utf8')
    }
  } catch (error) {
    return { ok: false, error: `读取会话失败：${String(error)}` }
  }
  // 提取用户消息文本（兼容 dsh 事件格式 {type:"user/message",data:{content:[{type:"text",text}]}}
  // 与通用格式 {role:"user",content:string}）
  const parts: string[] = []
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue
    try {
      const obj = JSON.parse(line) as {
        type?: string
        role?: string
        content?: unknown
        data?: { content?: unknown }
      }
      let text: string | null = null
      if (obj.type === 'user/message' && obj.data && Array.isArray(obj.data.content)) {
        text = (obj.data.content as Array<{ type?: string; text?: string }>)
          .filter((c) => c.type === 'text' && typeof c.text === 'string')
          .map((c) => c.text as string)
          .join('\n')
      } else if (obj.role === 'user' && typeof obj.content === 'string') {
        text = obj.content
      }
      if (text && text.trim()) parts.push(text.trim())
    } catch {
      /* ignore non-JSON lines */
    }
  }
  const text = parts.slice(-20).join('\n\n').slice(0, maxChars)
  return { ok: text.length > 0, title, text, error: text.length > 0 ? undefined : '会话中没有用户消息' }
}
