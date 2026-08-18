/**
 * v2.0 知识库模块：分类 + 知识条目（JSON 存储于 <workspace>/data/knowledge.json）。
 * - 提炼入库：SkillAdapter 接口（生产环境接入 knowledge-extraction 技能 / LLM），
 *   当前提供启发式 Mock 实现（代码块 + 经验段落识别）。
 * - 自动迭代：trigger 式合并去重（同标题归一化 + 内容完全去重）。
 * - 检索：关键词（title/content/tags 模糊）+ 分类 + 时间范围。
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { readJsonFile, writeJsonAtomic } from '../shared/workspace'
import { logger } from './logger'
import type {
  KnowledgeCategory,
  KnowledgeEntry,
  KnowledgeExtractInput,
  KnowledgeExtractResult,
  KnowledgeIterateResult,
  KnowledgePayload,
  KnowledgeSearchQuery,
  KnowledgeSearchResult
} from '../shared/ipc'

interface KnowledgeStore {
  version: number
  categories: KnowledgeCategory[]
  entries: KnowledgeEntry[]
}

function dataFile(workspaceDir: string): string {
  return path.join(workspaceDir, 'data', 'knowledge.json')
}

function emptyStore(): KnowledgeStore {
  return { version: 1, categories: [], entries: [] }
}

function readStore(workspaceDir: string): KnowledgeStore {
  const raw = readJsonFile(dataFile(workspaceDir))
  if (!raw || typeof raw !== 'object') return emptyStore()
  const s = raw as Partial<KnowledgeStore>
  return {
    version: 1,
    categories: Array.isArray(s.categories) ? (s.categories as KnowledgeCategory[]) : [],
    entries: Array.isArray(s.entries) ? (s.entries as KnowledgeEntry[]) : []
  }
}

function writeStore(workspaceDir: string, store: KnowledgeStore): void {
  try {
    writeJsonAtomic(dataFile(workspaceDir), store)
  } catch (error) {
    logger.error(`知识库保存失败：${String(error)}`)
    throw error
  }
}

function uid(): string {
  return crypto.randomUUID()
}

export function getKnowledge(workspaceDir: string): KnowledgePayload {
  const store = readStore(workspaceDir)
  const counts = new Map<string, number>()
  for (const e of store.entries) counts.set(e.categoryId, (counts.get(e.categoryId) ?? 0) + 1)
  return {
    categories: store.categories.map((c) => ({ ...c, entryCount: counts.get(c.id) ?? 0 })),
    entries: store.entries
  }
}

export function createKnowledgeCategory(workspaceDir: string, name: string): KnowledgeCategory {
  const trimmed = name.trim()
  if (!trimmed) throw new Error('分类名不能为空')
  const store = readStore(workspaceDir)
  const category: KnowledgeCategory = { id: uid(), name: trimmed, createdAt: Date.now(), entryCount: 0 }
  store.categories.push(category)
  writeStore(workspaceDir, store)
  return category
}

export function renameKnowledgeCategory(workspaceDir: string, id: string, name: string): boolean {
  const trimmed = name.trim()
  if (!trimmed) throw new Error('分类名不能为空')
  const store = readStore(workspaceDir)
  const cat = store.categories.find((c) => c.id === id)
  if (!cat) throw new Error('分类不存在')
  cat.name = trimmed
  writeStore(workspaceDir, store)
  return true
}

export function deleteKnowledgeCategory(workspaceDir: string, id: string): boolean {
  const store = readStore(workspaceDir)
  store.categories = store.categories.filter((c) => c.id !== id)
  store.entries = store.entries.filter((e) => e.categoryId !== id)
  writeStore(workspaceDir, store)
  return true
}

export function createKnowledgeEntry(
  workspaceDir: string,
  categoryId: string,
  input: { title: string; content: string; tags?: string[] }
): KnowledgeEntry {
  const store = readStore(workspaceDir)
  if (!store.categories.some((c) => c.id === categoryId)) throw new Error('分类不存在')
  const now = Date.now()
  const entry: KnowledgeEntry = {
    id: uid(),
    categoryId,
    title: input.title.trim() || '未命名知识',
    content: input.content,
    tags: (input.tags ?? []).slice(0, 12),
    createdAt: now,
    updatedAt: now
  }
  store.entries.push(entry)
  writeStore(workspaceDir, store)
  return entry
}

export function updateKnowledgeEntry(workspaceDir: string, id: string, patch: { title?: string; content?: string; tags?: string[] }): boolean {
  const store = readStore(workspaceDir)
  const entry = store.entries.find((e) => e.id === id)
  if (!entry) throw new Error('知识条目不存在')
  if (patch.title !== undefined) entry.title = patch.title.trim() || entry.title
  if (patch.content !== undefined) entry.content = patch.content
  if (patch.tags !== undefined) entry.tags = patch.tags.slice(0, 12)
  entry.updatedAt = Date.now()
  writeStore(workspaceDir, store)
  return true
}

export function deleteKnowledgeEntry(workspaceDir: string, id: string): boolean {
  const store = readStore(workspaceDir)
  store.entries = store.entries.filter((e) => e.id !== id)
  writeStore(workspaceDir, store)
  return true
}

export function searchKnowledge(workspaceDir: string, query: KnowledgeSearchQuery): KnowledgeSearchResult {
  const store = readStore(workspaceDir)
  const kw = (query.keyword ?? '').trim().toLowerCase()
  let entries = store.entries
  if (query.categoryId) entries = entries.filter((e) => e.categoryId === query.categoryId)
  if (query.from !== undefined) entries = entries.filter((e) => e.updatedAt >= query.from!)
  if (query.to !== undefined) entries = entries.filter((e) => e.updatedAt <= query.to!)
  if (kw) {
    entries = entries.filter((e) => {
      const hay = `${e.title} ${e.content} ${e.tags.join(' ')}`.toLowerCase()
      return kw.split(/\s+/).some((t) => hay.includes(t))
    })
  }
  return { ok: true, entries: entries.sort((a, b) => b.updatedAt - a.updatedAt) }
}

// ---------------------------------------------------------------------------
// SkillAdapter：知识提炼接口（生产环境接入 knowledge-extraction 技能 / LLM）
// ---------------------------------------------------------------------------

/**
 * TODO: Install specific skill for production —— 接入 dsh 会话内的
 * knowledge-extraction 技能或 LLM 调用，替换启发式实现。
 */
export interface SkillAdapter {
  /** 从会话文本提炼结构化知识条目。 */
  extract(input: KnowledgeExtractInput): Promise<Array<Pick<KnowledgeEntry, 'title' | 'content' | 'tags'>>>
}

/** 启发式 Mock 实现：识别代码块与「经验/方案/坑」段落，纯离线、确定性、可测试。 */
export const heuristicKnowledgeExtractor: SkillAdapter = {
  async extract(input) {
    const out: Array<Pick<KnowledgeEntry, 'title' | 'content' | 'tags'>> = []
    const text = input.sessionText ?? ''
    if (!text.trim()) return out

    // 1) 代码块 → 独立条目（标题取首行注释或「代码片段」）
    const codeBlocks = text.match(/```[\s\S]*?```/g) ?? []
    for (const block of codeBlocks) {
      const firstLine = block.split('\n')[0]?.replace(/^```/, '').trim() ?? ''
      const code = block.replace(/^```[^\n]*\n/, '').replace(/```$/, '').trim()
      if (!code) continue
      const comment = code.match(/(?:\/\/|#|--)\s*(.+)/)?.[1]?.trim()
      out.push({
        title: comment ? `代码片段：${comment.slice(0, 40)}` : '代码片段',
        content: block,
        tags: ['代码', firstLine || 'snippet']
      })
    }

    // 2) 「经验/方案/坑/总结」引导段落 → 知识条目（同 head 只保留一次）
    const sectionRe = /(?:经验|方案|解决|坑|总结|最佳实践)[：:]\s*([^\n]{2,120})/g
    const seenHeads = new Set<string>()
    let m: RegExpExecArray | null
    while ((m = sectionRe.exec(text))) {
      const head = m[1].trim()
      if (seenHeads.has(head)) continue
      seenHeads.add(head)
      const rest = text.slice(m.index + m[0].length, m.index + m[0].length + 300).split('\n\n')[0].trim()
      out.push({
        title: `经验：${head.slice(0, 40)}`,
        content: `${m[0].replace(/[：:]\s*/, '：')}\n${rest}`.trim(),
        tags: ['经验']
      })
    }

    // 3) 长段落（>80 字）作为候选知识
    for (const para of text.split(/\n{2,}/)) {
      const p = para.trim()
      if (p.length > 80 && !p.startsWith('```')) {
        out.push({ title: `笔记：${p.slice(0, 30)}…`, content: p, tags: ['笔记'] })
      }
    }
    // 去重（同 content）
    const seen = new Set<string>()
    return out.filter((e) => {
      if (seen.has(e.content)) return false
      seen.add(e.content)
      return true
    })
  }
}

/** 提炼入库：若未指定分类或分类不存在 → needCategory=true（UI 弹窗新建）。 */
export async function extractKnowledgeToStore(
  workspaceDir: string,
  input: KnowledgeExtractInput,
  adapter: SkillAdapter = heuristicKnowledgeExtractor
): Promise<KnowledgeExtractResult> {
  if (input.categoryId) {
    const store = readStore(workspaceDir)
    if (!store.categories.some((c) => c.id === input.categoryId)) {
      return { ok: false, needCategory: true, error: '目标分类不存在，请新建分类' }
    }
  }
  if (!input.categoryId) {
    return { ok: false, needCategory: true, error: '请先选择或新建知识分类' }
  }
  try {
    const extracted = await adapter.extract(input)
    const created = extracted.map((e) =>
      createKnowledgeEntry(workspaceDir, input.categoryId!, {
        title: e.title,
        content: e.content,
        tags: e.tags
      })
    )
    return { ok: true, entries: created.map(({ title, content, tags }) => ({ title, content, tags })) }
  } catch (error) {
    return { ok: false, error: String(error) }
  }
}

/** 知识迭代：合并同标题归一化条目、删除完全重复内容（trigger 式）。 */
export function iterateKnowledge(workspaceDir: string): KnowledgeIterateResult {
  const store = readStore(workspaceDir)
  const before = store.entries.length
  // 按 categoryId + 归一化标题分组
  const groups = new Map<string, KnowledgeEntry[]>()
  for (const e of store.entries) {
    const key = `${e.categoryId}::${normalizeTitle(e.title)}`
    const list = groups.get(key) ?? []
    list.push(e)
    groups.set(key, list)
  }
  const merged: KnowledgeEntry[] = []
  let removed = 0
  for (const list of groups.values()) {
    if (list.length === 1) {
      merged.push(list[0])
      continue
    }
    // 合并：保留最早条目，content 取最长者，tags 并集，时间更新
    const sorted = [...list].sort((a, b) => a.createdAt - b.createdAt)
    const base = sorted[0]
    const bestContent = sorted.reduce((longest, e) => (e.content.length > longest.content.length ? e : longest), base)
    merged.push({
      ...base,
      content: bestContent.content,
      tags: [...new Set(sorted.flatMap((e) => e.tags))].slice(0, 12),
      updatedAt: Date.now()
    })
    removed += sorted.length - 1
  }
  const after = merged.length
  store.entries = merged
  writeStore(workspaceDir, store)
  return {
    ok: true,
    removed,
    merged: before - after - removed > 0 ? 0 : before - after,
    message: `合并去重完成：${before} → ${after} 条（合并 ${removed} 条重复）`
  }
}

function normalizeTitle(title: string): string {
  return title.trim().toLowerCase().replace(/\s+/g, '')
}

/** 供测试：确保 data 目录存在。 */
export function ensureKnowledgeDir(workspaceDir: string): void {
  fs.mkdirSync(path.join(workspaceDir, 'data'), { recursive: true })
}
