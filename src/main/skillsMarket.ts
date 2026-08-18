/**
 * 推荐技能市场：知名开源技能库（anthropics/skills、obra/superpowers 等 GitHub 仓库，
 * 以及可从 npmmirror 直接安装的 npm 技能包）。
 *
 * 技能格式：dsh 技能 = 目录内一个 SKILL.md（含 frontmatter），目录名即技能名；
 * 安装目标：workspace/skills/<name>/（dsh-skill-filesystem 经 customSkillDirs 扫描）。
 *
 * GitHub 源安装：raw.githubusercontent → jsdelivr CDN 双源回退；
 * npm 源安装：npmmirror registry tarball 解包（无需 GitHub，本机可实测）。
 */
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { logger } from './logger'
import type { InstalledSkillInfo, SkillMarketItem } from '../shared/ipc'

export interface CuratedSkill {
  id: string
  name: string
  description: string
  tags: string[]
  source:
    | { type: 'github'; repo: string; path: string }
    | { type: 'npm'; pkg: string }
    | { type: 'npm-skill'; pkg: string; skill: string }
  recommended: boolean
}

/**
 * 推荐技能（50 个）：全部来自社区推崇的开源技能库。为离线可装、跨网络稳定，
 * 统一经 npm 技能合集包（claude-skills-library，npmmirror 直装，内含
 * anthropics/skills 与 obra/superpowers 等社区技能）按名提取单个技能；
 * GitHub 源保留给可直接访问 GitHub 的场景。
 */
const LIB = 'claude-skills-library'
function lib(skill: string, name: string, description: string, tags: string[]): CuratedSkill {
  return { id: skill, name, description, tags, source: { type: 'npm-skill', pkg: LIB, skill }, recommended: true }
}

/** GitHub 仓库来源的推荐技能（DSH_HH：客户端体验优化专项封装）。 */
function gh(skill: string, name: string, description: string, tags: string[]): CuratedSkill {
  return { id: skill, name, description, tags, source: { type: 'github', repo: 'gyg9006/DSH_HH', path: `skills/${skill}` }, recommended: true }
}

export const CURATED_SKILLS: CuratedSkill[] = [
  // ---- 文档办公（Anthropic 官方技能） ----
  lib('docx', 'Word 文档', '创建与编辑 .docx 文档（Anthropic 官方技能），可生成正式文档、报告与合同。', ['文档', 'docx', 'word', 'office']),
  lib('xlsx', 'Excel 表格', '创建与编辑 .xlsx 电子表格（Anthropic 官方技能），支持公式、样式与数据组织。', ['表格', 'xlsx', 'excel', 'office']),
  lib('pptx', 'PPT 演示', '创建与编辑 .pptx 演示文稿（Anthropic 官方技能），支持版式、母版与幻灯片生成。', ['演示', 'pptx', 'ppt', 'office']),
  lib('pdf', 'PDF 阅读', '读取与提取 PDF 内容（Anthropic 官方技能），用于总结、检索与问答。', ['pdf', '阅读', '提取', '文档']),
  lib('pdf-processing-pro', 'PDF 处理进阶', 'PDF 的解析、拆分、合并与内容提取（专业级处理流程）。', ['pdf', '处理', '解析']),
  lib('spreadsheet', '电子表格', '通用电子表格处理（数据整理、公式与格式化）。', ['表格', '电子表格', '数据']),
  lib('excel-analysis', 'Excel 数据分析', '用 Excel 做数据透视、统计分析与图表呈现。', ['excel', '分析', '统计']),
  lib('doc-coauthoring', '文档协作', '多人共同撰写与审阅长文档（Anthropic 官方技能）。', ['文档', '协作', '审阅']),
  lib('skill-creator', '技能创建器', '按规范创建新的 SKILL.md 技能（Anthropic 官方技能）。', ['技能', '创建', 'SKILL.md']),

  // ---- 工作方法（obra/superpowers） ----
  lib('brainstorming', '头脑风暴', '结构化头脑风暴与想法收敛（obra/superpowers），把模糊目标变成可执行方案。', ['头脑风暴', '创意', 'brainstorming']),
  lib('writing-plans', '实现计划', '生成测试优先的详细实现计划（obra/superpowers），适合零背景快速上手代码库。', ['计划', '编码', 'writing-plans', '测试']),
  lib('test-driven-development', '测试驱动开发', '严格的红-绿-重构 TDD 循环（obra/superpowers）。', ['tdd', '测试', '重构']),
  lib('subagent-driven-development', '子代理驱动开发', '用子代理并行开发与验证（obra/superpowers）。', ['子代理', '并行', '开发']),
  lib('code-review', '代码审查', '系统化代码审查清单与流程（obra/superpowers）。', ['审查', 'code-review', '质量']),
  lib('using-superpowers', 'Superpowers 使用指南', 'Superpowers 技能库的完整使用说明（obra/superpowers）。', ['superpowers', '指南', '工作流']),
  lib('planning', '计划制定', '把任务拆解为可执行的步骤与里程碑。', ['计划', '规划', '任务拆解']),

  // ---- 开发与工程 ----
  lib('debugging', '调试方法', '系统化定位与修复缺陷（问题复现→假设→验证）。', ['调试', 'debug', '缺陷']),
  lib('systematic-debugging', '系统化调试', '按证据链逐步缩小问题范围的调试流程。', ['调试', '系统化', '排查']),
  lib('refactoring', '重构', '在不改变行为的前提下改进代码结构。', ['重构', 'refactor', '代码质量']),
  lib('testing-patterns', '测试模式', '常见测试模式与断言策略（单元/集成/E2E）。', ['测试', '模式', '单元测试']),
  lib('performance-optimizer', '性能优化', '定位并消除性能瓶颈（CPU/内存/网络）。', ['性能', '优化', '瓶颈']),
  lib('api-design', 'API 设计', 'REST/OpenAPI 接口设计最佳实践。', ['api', '接口', '设计']),
  lib('database-design', '数据库设计', '表结构、索引与约束设计。', ['数据库', '设计', 'schema']),
  lib('sql-pro', 'SQL 进阶', '复杂查询、窗口函数与查询优化。', ['sql', '查询', '数据库']),
  lib('typescript-pro', 'TypeScript 进阶', '类型系统高级用法与工程化实践。', ['typescript', '类型', '前端']),
  lib('react-dev', 'React 开发', 'React 组件设计、Hooks 与性能优化。', ['react', '前端', '组件']),
  lib('python-pro', 'Python 进阶', 'Python 惯用法、性能与工程化。', ['python', '后端', '脚本']),
  lib('rust-pro', 'Rust 进阶', 'Rust 所有权、并发与性能安全实践。', ['rust', '系统', '性能']),
  lib('electron-development', 'Electron 开发', 'Electron 桌面应用开发与打包。', ['electron', '桌面', '打包']),
  lib('docker-expert', 'Docker 专家', '镜像构建、编排与容器化最佳实践。', ['docker', '容器', '部署']),
  lib('ci-cd', 'CI/CD 流水线', '持续集成与交付流水线设计。', ['ci', 'cd', '流水线', '自动化']),
  lib('astro', 'Astro 开发', 'Astro 静态站点与内容站点开发。', ['astro', '前端', '静态站点']),

  // ---- 研究与内容 ----
  lib('deep-research', '深度研究', '对复杂主题做系统化研究并整理结论与引用。', ['研究', '深度', '引用']),
  lib('browser-automation', '浏览器自动化', '用 Playwright 等做网页自动化与测试。', ['浏览器', '自动化', 'playwright']),
  lib('prompt-engineering', '提示词工程', '编写高效提示词、设计少样本与思维链。', ['提示词', 'prompt', '工程']),
  lib('rag-engineer', 'RAG 检索增强', '构建检索增强生成管道（向量库/重排）。', ['rag', '检索', '向量']),
  lib('copywriting', '文案写作', '面向转化与传播的营销文案。', ['文案', '写作', '营销']),
  lib('content-creator', '内容创作', '结构化产出文章、脚本与多平台内容。', ['内容', '创作', '写作']),
  lib('data-storytelling', '数据叙事', '把数据转化为有说服力的故事与可视化。', ['数据', '叙事', '可视化']),
  lib('seo', 'SEO 优化', '搜索引擎优化：关键词、结构与外链策略。', ['seo', '搜索', '优化']),
  lib('professional-communication', '专业沟通', '商务邮件、汇报与跨团队沟通规范。', ['沟通', '邮件', '汇报']),
  lib('email-composer', '邮件撰写', '撰写清晰、结构化的商务邮件。', ['邮件', '写作', '沟通']),

  // ---- 安全与运维 ----
  lib('security-audit', '安全审计', '代码与依赖的安全审计（漏洞/密钥泄露）。', ['安全', '审计', '漏洞']),
  lib('security-best-practices', '安全最佳实践', '开发中的安全基线（输入校验/认证/加密）。', ['安全', '最佳实践', '基线']),
  lib('threat-modeling-expert', '威胁建模', 'STRIDE 等威胁建模方法识别风险面。', ['威胁', '建模', '风险']),
  lib('cloud-architect', '云架构', '云上系统架构设计（可用性/成本/安全）。', ['云', '架构', '设计']),
  lib('cloudflare-deploy', 'Cloudflare 部署', 'Worker/Pages 部署与边缘配置。', ['cloudflare', '部署', '边缘']),
  lib('vercel-deploy', 'Vercel 部署', '前端项目 Vercel 部署与预览环境。', ['vercel', '部署', '前端']),
  lib('postgresql', 'PostgreSQL', 'Postgres 使用、优化与运维。', ['postgres', '数据库', '优化']),
  lib('postgres-best-practices', 'Postgres 最佳实践', 'Postgres 表设计、索引与迁移最佳实践。', ['postgres', '最佳实践', '索引']),

  // ---- DSH 桌面客户端体验优化专项（gyg9006/DSH_HH） ----
  gh('fast-downloader', 'FastDownloader 下载加速', '多线程 Range 分片下载 + 断点续传 + 镜像测速 + SHA256 校验（客户端更新/环境包下载）。', ['下载', '分片', '续传', 'sha256', '镜像']),
  gh('workspace-migrator', '工作文件夹原子迁移', '流式复制 → 完整性校验 → 配置切换 → 旧目录备份 → 失败回滚 的工作目录迁移。', ['迁移', '工作文件夹', '原子', '回滚']),
  gh('portable-env-installer', '便携环境一键安装', '打包内置 Node/Git/pnpm/dsh 便携环境（env-manifest 版本锁定 + sha256），离线优先、网络兜底。', ['环境', '便携', '离线', 'node', 'git']),
  gh('onboarding-wizard', '首次启动三步引导', '工作文件夹 → 环境检测/一键安装 → API Key 配置并测试 的三步引导向导 + 入口守卫 + 白屏兜底。', ['引导', 'onboarding', '首次启动', '白屏']),
  gh('image-processor', '图片处理与会话背景', 'Canvas 压缩 ≤2K、渐变预设、背景填充/透明度/模糊控制（零原生依赖）。', ['图片', '背景', '压缩', '渐变']),
  gh('smart-sync-engine', 'Git 时间戳智能同步', '本地 mtime vs 远端提交时间比对（谁新谁赢），容差窗口内容比对判冲突 + 冲突三选一。', ['同步', 'git', '时间戳', '冲突', '预览'])
]

export function skillMarketItems(workspaceDir: string): SkillMarketItem[] {
  const installed = new Set(listInstalledSkills(workspaceDir).map((s) => s.id))
  return CURATED_SKILLS.map((s) => ({
    id: s.id,
    name: s.name,
    description: s.description,
    tags: s.tags,
    source: s.source,
    recommended: s.recommended,
    installed: installed.has(s.id)
  }))
}

/**
 * 联网搜索技能：从 npmmirror 检索「技能类」npm 包（按名字 / 功能词 / skill 关键词）。
 * 结果可直接用 installSkillFromNpmCollection 按包安装（包内含 SKILL.md 目录的技能）。
 */
export async function searchNpmSkills(
  query: string
): Promise<{ ok: boolean; hits: Array<{ name: string; description: string; keywords: string[] }>; error?: string }> {
  const raw = query.trim()
  if (!raw) return { ok: true, hits: [] }
  // 包名精确查询（用户输入完整包名时直查元数据）
  if (/^(@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/i.test(raw) && !/[\u4e00-\u9fff]/.test(raw)) {
    try {
      const meta = await fetch(`https://registry.npmmirror.com/${encodeURIComponent(raw)}`)
      if (meta.ok) {
        const pkg = (await meta.json()) as { name?: unknown; description?: unknown; keywords?: unknown; 'dist-tags'?: { latest?: unknown } }
        if (typeof pkg.name === 'string') {
          return {
            ok: true,
            hits: [
              {
                name: pkg.name,
                description: typeof pkg.description === 'string' ? pkg.description : '',
                keywords: Array.isArray(pkg.keywords) ? pkg.keywords.map((k) => String(k)) : []
              }
            ]
          }
        }
      }
    } catch {
      /* 直查失败 → 全文搜索 */
    }
  }
  // 全文搜索：把中文功能词与「skill」/「skills」关键词组合检索
  const searchText = raw.includes('skill') || /[\u4e00-\u9fff]/.test(raw) ? raw : `${raw} skill`
  const url = `https://registry.npmmirror.com/-/v1/search?text=${encodeURIComponent(searchText)}&size=30`
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) })
    if (!res.ok) return { ok: false, hits: [], error: `搜索服务返回 HTTP ${res.status}` }
    const body = (await res.json()) as { objects?: Array<{ package?: { name?: unknown; description?: unknown; keywords?: unknown } }> }
    let hits: Array<{ name: string; description: string; keywords: string[] }> = []
    for (const obj of Array.isArray(body?.objects) ? body.objects : []) {
      const p = obj?.package
      if (!p || typeof p !== 'object') continue
      const name = typeof p.name === 'string' ? p.name : ''
      if (!name) continue
      const kw = Array.isArray(p.keywords) ? p.keywords.map((k) => String(k)) : []
      hits.push({
        name,
        description: typeof p.description === 'string' ? p.description : '',
        keywords: kw
      })
    }
    // 中文功能词：只保留名字/描述/关键词含该词的条目
    const hasCjk = /[\u4e00-\u9fff]/.test(raw)
    if (hasCjk) {
      hits = hits.filter((h) => {
        const hay = `${h.name} ${h.description} ${h.keywords.join(' ')}`.toLowerCase()
        return raw.toLowerCase().split(/\s+/).some((t) => hay.includes(t))
      })
    }
    // 优先「技能类」包（名字/关键词含 skill）
    hits.sort((a, b) => {
      const score = (h: { name: string; keywords: string[] }): number =>
        (h.name.toLowerCase().includes('skill') ? 2 : 0) + (h.keywords.some((k) => /skill/i.test(k)) ? 1 : 0)
      return score(b) - score(a)
    })
    return { ok: true, hits }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    if (error instanceof DOMException && error.name === 'TimeoutError') {
      return { ok: false, hits: [], error: '搜索超时（15 秒）' }
    }
    return { ok: false, hits: [], error: `搜索失败：${reason}` }
  }
}

/** 按包名从 npm 安装技能（包内所有含 SKILL.md 的技能目录都会安装到 workspace/skills）。 */
export async function installSkillFromNpmPackage(
  workspaceDir: string,
  pkg: string,
  log: (msg: string) => void
): Promise<{ ok: boolean; error?: string; installed: string[] }> {
  return installSkillsFromNpm(workspaceDir, pkg, log)
}

/** 已安装技能（workspace/skills 下含 SKILL.md 的目录）。 */
export function listInstalledSkills(workspaceDir: string): InstalledSkillInfo[] {
  const root = path.join(workspaceDir, 'skills')
  if (!fs.existsSync(root)) return []
  const out: InstalledSkillInfo[] = []
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const skillMd = path.join(root, entry.name, 'SKILL.md')
    if (!fs.existsSync(skillMd)) continue
    const stat = fs.statSync(skillMd)
    out.push({ id: entry.name, path: skillMd, sizeBytes: stat.size, mtime: stat.mtimeMs })
  }
  return out.sort((a, b) => a.id.localeCompare(b.id))
}

function skillsRoot(workspaceDir: string): string {
  return path.join(workspaceDir, 'skills')
}

// ---------------------------------------------------------------------------
// npm 源：npmmirror tarball 解包
// ---------------------------------------------------------------------------

/** 极简 tar 解析（gzip 已解压）：返回 { path, content } 列表。路径已规范化并拒绝穿越/绝对路径。 */
export function parseTar(buffer: Buffer): Array<{ path: string; content: Buffer }> {
  const out: Array<{ path: string; content: Buffer }> = []
  let off = 0
  while (off + 512 <= buffer.length) {
    const header = buffer.subarray(off, off + 512)
    const name = header.subarray(0, 100).toString('utf8').replace(/\0.*$/, '')
    if (!name) break
    const size = parseInt(header.subarray(124, 136).toString('utf8').replace(/\0.*$/, '').trim() || '0', 8) || 0
    const type = header.subarray(156, 157).toString('utf8') || '0'
    if (type === '0' || type === '') {
      // 安全校验：规范化后必须仍是相对路径（拒绝 ../ 逃逸与绝对路径）
      const normalized = path.posix.normalize(name.replace(/\\/g, '/')).replace(/^\.\/+/, '')
      if (!normalized || normalized.startsWith('../') || path.posix.isAbsolute(normalized)) {
        throw new Error(`tar 条目路径不安全：${name}`)
      }
      out.push({ path: normalized, content: buffer.subarray(off + 512, off + 512 + size) })
    }
    off += 512 + Math.ceil(size / 512) * 512
  }
  return out
}

/** 从 npm 包安装技能：解包后把每个含 SKILL.md 的目录复制到 workspace/skills。 */
export async function installSkillsFromNpm(
  workspaceDir: string,
  pkg: string,
  log: (msg: string) => void
): Promise<{ ok: boolean; error?: string; installed: string[] }> {
  try {
    log(`从 npmmirror 获取 ${pkg} 元数据…`)
    const metaRes = await fetch(`https://registry.npmmirror.com/${encodeURIComponent(pkg)}`, {
      signal: AbortSignal.timeout(20000)
    })
    if (!metaRes.ok) return { ok: false, error: `npm 元数据返回 HTTP ${metaRes.status}`, installed: [] }
    const meta = (await metaRes.json()) as { 'dist-tags'?: { latest?: unknown }; versions?: Record<string, unknown> }
    const latest = typeof meta['dist-tags']?.latest === 'string' ? meta['dist-tags'].latest : ''
    const ver = (meta.versions ?? {})[latest] as { dist?: { tarball?: unknown } } | undefined
    const tarball = ver?.dist?.tarball
    if (!latest || typeof tarball !== 'string') return { ok: false, error: '无法解析 npm 包版本', installed: [] }

    log(`下载 ${pkg}@${latest} …`)
    const tarRes = await fetch(tarball, { signal: AbortSignal.timeout(60000) })
    if (!tarRes.ok) return { ok: false, error: `下载失败（HTTP ${tarRes.status}）`, installed: [] }
    const tarBuf = zlib.gunzipSync(Buffer.from(await tarRes.arrayBuffer()))
    const entries = parseTar(tarBuf)

    // 找到所有含 SKILL.md 的目录
    const dirs = new Map<string, Array<{ path: string; content: Buffer }>>()
    for (const e of entries) {
      if (path.basename(e.path).toLowerCase() === 'skill.md') {
        const dir = path.posix.dirname(e.path)
        dirs.set(dir, [])
      }
    }
    for (const e of entries) {
      for (const dir of dirs.keys()) {
        if (e.path === dir || e.path.startsWith(dir + '/')) {
          const rel = e.path.slice(dir.length + 1)
          if (rel) dirs.get(dir)!.push({ path: rel, content: e.content })
        }
      }
    }

    const root = skillsRoot(workspaceDir)
    fs.mkdirSync(root, { recursive: true })
    const installed: string[] = []
    for (const [dir, files] of dirs) {
      const skillName = path.posix.basename(dir)
      if (!/^[a-zA-Z0-9._-]+$/.test(skillName)) continue
      const dest = path.join(root, skillName)
      fs.mkdirSync(dest, { recursive: true })
      for (const f of files) {
        const target = path.join(dest, f.path)
        fs.mkdirSync(path.dirname(target), { recursive: true })
        fs.writeFileSync(target, f.content)
      }
      installed.push(skillName)
    }
    if (installed.length === 0) return { ok: false, error: '该包内没有找到 SKILL.md 技能', installed: [] }
    logger.info(`npm 技能包 ${pkg} 安装完成：${installed.join(', ')}`)
    return { ok: true, installed }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    return { ok: false, error: `安装失败：${reason}`, installed: [] }
  }
}

// ---------------------------------------------------------------------------
// GitHub 源：raw.githubusercontent → jsdelivr CDN 回退
// ---------------------------------------------------------------------------

/** 获取文件内容：raw.githubusercontent → jsdelivr 双源回退。 */
async function fetchFile(repo: string, filePath: string, log: (msg: string) => void): Promise<Buffer | null> {
  const sources = [
    `https://raw.githubusercontent.com/${repo}/${GH_BRANCH}/${filePath}`,
    `https://cdn.jsdelivr.net/gh/${repo}@${GH_BRANCH}/${filePath}`
  ]
  for (const url of sources) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(20000) })
      if (res.ok) return Buffer.from(await res.arrayBuffer())
    } catch {
      // 尝试下一源
    }
  }
  log(`无法访问 ${filePath}（raw.githubusercontent 与 jsdelivr 均不可达，请检查网络）`)
  return null
}

/** 从 GitHub 仓库安装技能目录（SKILL.md + reference/ 等文件）。 */
export async function installSkillFromGithub(
  workspaceDir: string,
  repo: string,
  skillPath: string,
  skillName: string,
  log: (msg: string) => void
): Promise<{ ok: boolean; error?: string; installed: string[] }> {
  const files: string[] = []
  // 尝试 jsdelivr 文件列表 API 获取目录内容
  try {
    const api = `https://data.jsdelivr.com/v1/packages/gh/${repo}@${GH_BRANCH}`
    const res = await fetch(api, { signal: AbortSignal.timeout(20000) })
    if (res.ok) {
      const tree = (await res.json()) as { files?: Array<{ name?: unknown; path?: unknown }> }
      for (const f of Array.isArray(tree?.files) ? tree.files : []) {
        if (typeof f.path === 'string' && f.path.startsWith(skillPath + '/')) {
          files.push(f.path.slice(skillPath.length + 1))
        }
      }
    }
  } catch {
    // 列表不可用 → 退化为仅 SKILL.md
  }
  if (files.length === 0) files.push('SKILL.md')
  // 只保留常规文件（跳过嵌套目录占位）
  const keep = files.filter((f) => !f.endsWith('/') && !f.endsWith('.DS_Store') && f.split('/').length <= 3)

  const root = skillsRoot(workspaceDir)
  const dest = path.join(root, skillName)
  fs.mkdirSync(dest, { recursive: true })
  const installed: string[] = []
  for (const f of keep) {
    const data = await fetchFile(repo, `${skillPath}/${f}`, log)
    if (data) {
      const target = path.join(dest, f)
      fs.mkdirSync(path.dirname(target), { recursive: true })
      fs.writeFileSync(target, data)
    }
  }
  if (!fs.existsSync(path.join(dest, 'SKILL.md'))) {
    fs.rmSync(dest, { recursive: true, force: true })
    return { ok: false, error: '下载失败：SKILL.md 未获取到（当前网络无法访问 GitHub，可稍后重试或改用 npm 源技能）', installed: [] }
  }
  installed.push(skillName)
  logger.info(`GitHub 技能 ${repo}#${skillPath} 安装完成`)
  return { ok: true, installed }
}

/** GitHub 默认分支（skill 仓库均为 main）。 */
const GH_BRANCH = 'main'

/** 从 npm 技能合集包中按名提取单个技能（如 claude-skills-library 内的 docx）。 */
export async function installSkillFromNpmCollection(
  workspaceDir: string,
  pkg: string,
  skillName: string,
  log: (msg: string) => void
): Promise<{ ok: boolean; error?: string; installed: string[] }> {
  try {
    log(`从 npmmirror 获取 ${pkg} 元数据…`)
    const metaRes = await fetch(`https://registry.npmmirror.com/${encodeURIComponent(pkg)}`, {
      signal: AbortSignal.timeout(20000)
    })
    if (!metaRes.ok) return { ok: false, error: `npm 元数据返回 HTTP ${metaRes.status}`, installed: [] }
    const meta = (await metaRes.json()) as { 'dist-tags'?: { latest?: unknown }; versions?: Record<string, unknown> }
    const latest = typeof meta['dist-tags']?.latest === 'string' ? meta['dist-tags'].latest : ''
    const ver = (meta.versions ?? {})[latest] as { dist?: { tarball?: unknown } } | undefined
    const tarball = ver?.dist?.tarball
    if (!latest || typeof tarball !== 'string') return { ok: false, error: '无法解析 npm 包版本', installed: [] }

    log(`下载 ${pkg}@${latest}（按名提取 ${skillName}）…`)
    const tarRes = await fetch(tarball, { signal: AbortSignal.timeout(60000) })
    if (!tarRes.ok) return { ok: false, error: `下载失败（HTTP ${tarRes.status}）`, installed: [] }
    const entries = parseTar(zlib.gunzipSync(Buffer.from(await tarRes.arrayBuffer())))

    // 找到 basename === skillName 且含 SKILL.md 的目录
    let targetDir: string | null = null
    for (const e of entries) {
      if (path.basename(e.path).toLowerCase() === 'skill.md' && path.posix.basename(path.posix.dirname(e.path)) === skillName) {
        targetDir = path.posix.dirname(e.path)
        break
      }
    }
    if (!targetDir) {
      return { ok: false, error: `技能合集 ${pkg} 中没有找到 ${skillName}`, installed: [] }
    }

    const dest = path.join(skillsRoot(workspaceDir), skillName)
    fs.rmSync(dest, { recursive: true, force: true })
    fs.mkdirSync(dest, { recursive: true })
    for (const e of entries) {
      if (e.path === targetDir || e.path.startsWith(targetDir + '/')) {
        const rel = e.path.slice(targetDir.length + 1)
        if (!rel) continue
        const target = path.join(dest, rel)
        fs.mkdirSync(path.dirname(target), { recursive: true })
        fs.writeFileSync(target, e.content)
      }
    }
    if (!fs.existsSync(path.join(dest, 'SKILL.md'))) {
      fs.rmSync(dest, { recursive: true, force: true })
      return { ok: false, error: '提取失败：SKILL.md 缺失', installed: [] }
    }
    logger.info(`npm 技能 ${skillName}（${pkg}）安装完成`)
    return { ok: true, installed: [skillName] }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    return { ok: false, error: `安装失败：${reason}`, installed: [] }
  }
}

/** 安装推荐技能。 */
export async function installSkill(
  workspaceDir: string,
  skill: CuratedSkill,
  log: (msg: string) => void
): Promise<{ ok: boolean; error?: string; installed: string[] }> {
  if (skill.source.type === 'npm') {
    return installSkillsFromNpm(workspaceDir, skill.source.pkg, log)
  }
  if (skill.source.type === 'npm-skill') {
    return installSkillFromNpmCollection(workspaceDir, skill.source.pkg, skill.source.skill, log)
  }
  return installSkillFromGithub(workspaceDir, skill.source.repo, skill.source.path, skill.id, log)
}
