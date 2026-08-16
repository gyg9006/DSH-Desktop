/**
 * M4：会话列表读取（规格 5.2）。
 * 数据源：workspace/data/sessions/<workspace>/<session-id>/session.jsonl[.zstd]（真实 dsh 嵌套布局）；
 * 标题与时间：workspace/data/storages/session_projcache.json 的 tables.sessions.<id>
 * （identity.createdAt 与 rows.title.val；dsh 运行时自动维护，已从真实数据核实）。
 * 置顶状态：workspace/config/session-pins.json（本应用维护）。
 */
import fs from 'node:fs'
import path from 'node:path'
import { zstdCompress, zstdDecompress } from 'node:zlib'
import { promisify } from 'node:util'
import { readJsonFile, writeJsonAtomic } from '../shared/workspace'
import { runCommand } from './utils/process'
import { logger } from './logger'
import type { SessionEntry } from '../shared/ipc'

const zstdCompressAsync = promisify(zstdCompress)
const zstdDecompressAsync = promisify(zstdDecompress)

const SESSION_FILE_RE = /^session\.jsonl(\.zstd)?$/
const ZSTD_SUFFIX = '.jsonl.zstd'

/** 常见压缩包扩展名（导入时自动解压）。 */
const ARCHIVE_RE = /\.(zip|tar|tgz|tar\.gz|gz)$/i

/**
 * 导入前展开压缩包（.zip / .tar / .tgz / .tar.gz）：用 Windows bsdtar 解压到临时目录，
 * 返回展开后的路径列表 + 解压根目录集合（按树导入）+ 清理函数。
 * 解压失败时保留原路径按普通文件处理。
 */
export async function expandImportArchives(
  workspaceDir: string,
  paths: string[]
): Promise<{ paths: string[]; cleanup: () => void; archiveRoots: Set<string> }> {
  const result: string[] = []
  const archiveRoots = new Set<string>()
  const tempDirs: string[] = []
  for (const p of paths) {
    if (!ARCHIVE_RE.test(p)) {
      result.push(p)
      continue
    }
    const tmp = path.join(workspaceDir, 'tmp', `import-${Date.now()}-${Math.floor(Math.random() * 1e6)}`)
    fs.mkdirSync(tmp, { recursive: true })
    const r = await runCommand({ command: 'tar', args: ['-xf', p, '-C', tmp], timeoutMs: 120000 })
    if (r.error || r.code !== 0) {
      fs.rmSync(tmp, { recursive: true, force: true })
      result.push(p)
    } else {
      tempDirs.push(tmp)
      result.push(tmp)
      archiveRoots.add(tmp)
    }
  }
  return {
    paths: result,
    archiveRoots,
    cleanup: () => {
      for (const d of tempDirs) fs.rmSync(d, { recursive: true, force: true })
    }
  }
}

interface ProjCacheShape {
  tables?: {
    sessions?: Record<string, { identity?: { createdAt?: number }; rows?: { title?: { val?: string } } }>
  }
}

/** 读取 projcache 中的会话标题与创建时间（纯函数，可单测）。 */
export function readSessionMeta(projCache: unknown): Map<string, { title?: string; createdAt?: number }> {
  const map = new Map<string, { title?: string; createdAt?: number }>()
  if (!projCache || typeof projCache !== 'object') return map
  const sessions = (projCache as ProjCacheShape).tables?.sessions
  if (!sessions) return map
  for (const [id, entry] of Object.entries(sessions)) {
    const title = entry?.rows?.title?.val
    const createdAt = entry?.identity?.createdAt
    if (title || createdAt !== undefined) {
      map.set(id, { title, createdAt })
    }
  }
  return map
}

/** 读取置顶状态。 */
export function readSessionPins(workspaceDir: string): Set<string> {
  const raw = readJsonFile(path.join(workspaceDir, 'config', 'session-pins.json'))
  if (!raw || typeof raw !== 'object') return new Set()
  const ids = (raw as { pinned?: string[] }).pinned
  return new Set(Array.isArray(ids) ? ids : [])
}

export function writeSessionPins(workspaceDir: string, pins: Set<string>): void {
  writeJsonAtomic(path.join(workspaceDir, 'config', 'session-pins.json'), { pinned: [...pins] })
}

/** 递归收集会话文件，返回 { 会话目录, 文件路径 }。 */
function collectSessionDirs(sessionsRoot: string): Array<{ dir: string; file: string }> {
  const out: Array<{ dir: string; file: string }> = []
  if (!fs.existsSync(sessionsRoot)) return out
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(full)
      } else if (entry.isFile() && SESSION_FILE_RE.test(entry.name)) {
        out.push({ dir, file: full })
      }
    }
  }
  walk(sessionsRoot)
  return out
}

/** 会话列表（按时间倒序，置顶优先）。 */
export function listSessions(workspaceDir: string): SessionEntry[] {
  const sessionsRoot = path.join(workspaceDir, 'data', 'sessions')
  const collected = collectSessionDirs(sessionsRoot)
  const meta = readSessionMeta(readJsonFile(path.join(workspaceDir, 'data', 'storages', 'session_projcache.json')))
  const pins = readSessionPins(workspaceDir)

  const entries: SessionEntry[] = collected.map(({ dir, file }) => {
    const id = path.basename(dir)
    const info = meta.get(id)
    const stat = fs.statSync(file)
    const title = info?.title?.trim() || id
    const time = info?.createdAt ?? stat.mtimeMs
    return { id, title, time, path: file, pinned: pins.has(id) }
  })

  return entries.sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
    return b.time - a.time
  })
}

export function pinSession(workspaceDir: string, id: string, pinned: boolean): void {
  const pins = readSessionPins(workspaceDir)
  if (pinned) pins.add(id)
  else pins.delete(id)
  writeSessionPins(workspaceDir, pins)
}

/** 删除会话（移除其所在会话目录）。返回是否成功。 */
export function deleteSession(workspaceDir: string, id: string): { ok: boolean; error?: string } {
  const sessionsRoot = path.join(workspaceDir, 'data', 'sessions')
  if (!fs.existsSync(sessionsRoot)) return { ok: false, error: '会话目录不存在' }
  try {
    let target: string | null = null
    for (const entry of fs.readdirSync(sessionsRoot, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        const sub = path.join(sessionsRoot, entry.name)
        const nested = fs.readdirSync(sub, { withFileTypes: true }).find((e) => e.isDirectory() && e.name === id)
        if (nested) {
          target = path.join(sub, id)
          break
        }
      } else if (entry.name === id) {
        target = path.join(sessionsRoot, id)
        break
      }
    }
    if (!target) {
      // 递归查找（兜底）
      const walk = (dir: string): string | null => {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, e.name)
          if (e.isDirectory()) {
            if (e.name === id) return full
            const found = walk(full)
            if (found) return found
          }
        }
        return null
      }
      target = walk(sessionsRoot)
    }
    if (!target) return { ok: false, error: `未找到会话：${id}` }
    fs.rmSync(target, { recursive: true, force: true })
    // 同步清理置顶状态
    const pins = readSessionPins(workspaceDir)
    if (pins.delete(id)) writeSessionPins(workspaceDir, pins)
    return { ok: true }
  } catch (error) {
    return { ok: false, error: `删除失败：${error instanceof Error ? error.message : String(error)}` }
  }
}

// ---------------------------------------------------------------------------
// 导入会话（需求：把别的 PC 的 dsh 会话导入本机继续使用）
// ---------------------------------------------------------------------------

/** 判断目录是否为会话目录（含 session.jsonl[.zstd]）。 */
function isSessionDir(dir: string): boolean {
  try {
    return fs.readdirSync(dir).some((f) => SESSION_FILE_RE.test(f))
  } catch {
    return false
  }
}

/** 目录里是否只有该文件（用于判断「独立导出的会话文件」）。 */
function dirHasOnly(parent: string, name: string): boolean {
  try {
    return fs.readdirSync(parent).every((f) => f === name)
  } catch {
    return false
  }
}

/** 递归收集目录树中所有会话目录。 */
function collectSessionDirsRecursive(root: string, out: string[]): void {
  if (!fs.existsSync(root)) return
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const full = path.join(root, entry.name)
    if (isSessionDir(full)) {
      out.push(full)
    } else {
      collectSessionDirsRecursive(full, out)
    }
  }
}

/**
 * 收集目录树中「游离的会话文件」：父目录不是会话目录的 session.jsonl[.zstd] 文件
 * （如压缩包里散放的多个会话文件），每个文件作为一个独立会话导入。
 */
function collectStandaloneSessionFiles(
  root: string,
  sessionDirs: Set<string>,
  out: Array<{ srcDir: string; id: string; standaloneFile?: string }>
): void {
  if (!fs.existsSync(root)) return
  const walk = (dir: string): void => {
    let entries
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        if (!sessionDirs.has(full)) walk(full)
      } else if (SESSION_FILE_RE.test(entry.name) && !sessionDirs.has(dir)) {
        const fileId = entry.name.replace(SESSION_FILE_RE, '') || 'session'
        out.push({ srcDir: dir, id: fileId, standaloneFile: entry.name })
      }
    }
  }
  walk(root)
}

/** 判断会话 id 是否已在 data/sessions 下任何分组存在（dsh 会话 id 全局唯一）。 */
function sessionIdExists(sessionsRoot: string, id: string): boolean {
  if (!fs.existsSync(sessionsRoot)) return false
  for (const group of fs.readdirSync(sessionsRoot, { withFileTypes: true })) {
    if (!group.isDirectory()) continue
    if (fs.existsSync(path.join(sessionsRoot, group.name, id))) return true
  }
  return false
}

// ---------------------------------------------------------------------------
// 会话文件压缩格式适配
// dsh 的 session-persistence-jsonl 按 compression（默认 zstd）扫描整个 sessions 根，
// 遇到相反编码的会话文件会抛错阻止启动。导入时必须把会话转换到目标压缩格式。
// ---------------------------------------------------------------------------

export type SessionCompression = 'zstd' | 'none'

/** 读取 dsh 配置的会话压缩格式（settings.yaml 的 session-persistence-jsonl.compression，缺省 zstd）。 */
export function getDshSessionCompression(workspaceDir: string): SessionCompression {
  try {
    const raw = fs.readFileSync(path.join(workspaceDir, 'data', 'settings.yaml'), 'utf8')
    const m = raw.match(/^session-persistence-jsonl:[\s\S]*?^(\s*)compression:\s*(\w+)/m)
    if (m && m[2] === 'none') return 'none'
    const flat = raw.match(/^compression:\s*(\w+)/m)
    if (flat && flat[1] === 'none') return 'none'
  } catch {
    /* 忽略 */
  }
  return 'zstd'
}

/** 判断文件名是否为 zstd 压缩的会话日志。 */
function isZstdFile(name: string): boolean {
  return name === ZSTD_SUFFIX || name.endsWith(ZSTD_SUFFIX) || (name.endsWith('.zstd') && name.includes('.jsonl'))
}

/** 把单个会话文件转换到目标压缩格式（就地替换 + 删除原文件）。 */
export async function convertSessionFile(filePath: string, target: SessionCompression): Promise<void> {
  const name = path.basename(filePath)
  const dir = path.dirname(filePath)
  const currentZstd = isZstdFile(name)
  const wantZstd = target === 'zstd'
  if (currentZstd === wantZstd) return

  const data = fs.readFileSync(filePath)
  let converted: Buffer
  if (wantZstd) {
    converted = await zstdCompressAsync(data)
  } else {
    converted = await zstdDecompressAsync(data)
  }
  const destName = wantZstd ? 'session.jsonl.zstd' : 'session.jsonl'
  fs.writeFileSync(path.join(dir, destName), converted)
  fs.rmSync(filePath, { force: true })
}

/** 把会话目录内的 session 日志转换到目标压缩格式（兼容 session.jsonl / session.jsonl.zstd 两种命名）。 */
export async function convertSessionDirEncoding(sessionDir: string, target: SessionCompression): Promise<void> {
  if (!fs.existsSync(sessionDir)) return
  for (const f of fs.readdirSync(sessionDir)) {
    if (!SESSION_FILE_RE.test(f)) continue
    await convertSessionFile(path.join(sessionDir, f), target)
  }
}

/**
 * 扫描整个 sessions 根，把与 dsh 配置压缩格式不符的会话日志就地转换为目标格式。
 * dsh 的 session-persistence-jsonl 启动时全根校验，格式不符会直接抛错阻止服务启动；
 * 该修复在服务启动前执行，保证任何来源导入的会话（压缩/未压缩）都能被正常加载。
 * 返回转换的会话目录数。
 */
export async function repairSessionEncodings(workspaceDir: string): Promise<{ fixed: number; target: SessionCompression }> {
  const sessionsRoot = path.join(workspaceDir, 'data', 'sessions')
  if (!fs.existsSync(sessionsRoot)) return { fixed: 0, target: 'zstd' }
  const target = getDshSessionCompression(workspaceDir)
  let fixed = 0
  const walk = async (dir: string): Promise<void> => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        await walk(full)
      } else if (SESSION_FILE_RE.test(entry.name)) {
        const currentZstd = isZstdFile(entry.name)
        const wantZstd = target === 'zstd'
        if (currentZstd !== wantZstd) {
          await convertSessionFile(full, target)
          fixed += 1
        }
      }
    }
  }
  await walk(sessionsRoot)
  if (fixed > 0) logger.info(`会话编码修复：${fixed} 个会话已转换到 ${target} 格式`)
  return { fixed, target }
}

/**
 * 从外部路径导入会话：源可以是会话目录、单个会话文件或含会话的目录树（可多选混搭）。
 * 按 dsh 布局复制到 data/sessions/<来源名>/<会话id>/；id 冲突（全局）时重命名。
 * - 目录：会话目录直接导入；普通目录递归收集其中的会话目录 + 树内游离的会话文件。
 * - 文件：session.jsonl[.zstd] 视为单个会话文件——其父目录是会话目录时导入父目录；
 *   否则（独立导出的文件）以文件本身创建一个会话目录。
 * - targetWorkspacePath：指定导入到哪个工作区（来源名 = 该路径转义）；为空时用源路径父目录名。
 * - archiveRoots：压缩包解压根目录集合——这些目录一律按「树」处理（不做单会话目录判定），
 *   避免含多个会话的压缩包被误认为单个会话目录。
 */
export async function importSessionsFrom(
  workspaceDir: string,
  sourcePaths: string[],
  targetWorkspacePath?: string,
  archiveRoots?: Set<string>
): Promise<{ ok: boolean; count: number; error?: string }> {
  const sessionsRoot = path.join(workspaceDir, 'data', 'sessions')
  fs.mkdirSync(sessionsRoot, { recursive: true })
  let imported = 0
  try {
    // 收集需要导入的「会话目录」（去重：同一来源目录只导入一次）
    const seen = new Set<string>()
    const toImport: Array<{ srcDir: string; id: string; standaloneFile?: string }> = []
    for (const raw of sourcePaths) {
      if (!raw) continue
      const src = path.resolve(raw)
      if (!fs.existsSync(src)) continue
      const stat = fs.statSync(src)
      const isSessionFile = stat.isFile() && SESSION_FILE_RE.test(path.basename(src))
      if (
        stat.isFile() &&
        isSessionFile &&
        (!isSessionDir(path.dirname(src)) || dirHasOnly(path.dirname(src), path.basename(src)))
      ) {
        // 独立会话文件：以文件名（去掉扩展名）为会话 id，文件本身作为会话日志
        const fileId = path.basename(src).replace(SESSION_FILE_RE, '') || 'session'
        toImport.push({ srcDir: path.dirname(src), id: fileId, standaloneFile: path.basename(src) })
        continue
      }
      const sessionDirs: string[] = []
      if (stat.isFile()) {
        const parent = path.dirname(src)
        if (isSessionDir(parent)) sessionDirs.push(parent)
      } else if (isSessionDir(src) && !archiveRoots?.has(src)) {
        sessionDirs.push(src)
      } else {
        collectSessionDirsRecursive(src, sessionDirs)
        // 同时收集树内「游离的会话文件」（不在任何会话目录内，如压缩包里散放的会话文件）
        collectStandaloneSessionFiles(src, new Set(sessionDirs), toImport)
      }
      for (const dir of sessionDirs) {
        const canonical = fs.realpathSync(dir)
        if (seen.has(canonical)) continue
        seen.add(canonical)
        toImport.push({ srcDir: dir, id: path.basename(dir) })
      }
    }

    // 目标压缩格式（dsh 配置，缺省 zstd）
    const targetCompression = getDshSessionCompression(workspaceDir)

    for (const { srcDir: dir, id, standaloneFile } of toImport) {
      // 来源名：目标工作区路径转义（指定时），否则源路径父目录名
      const sourceName = targetWorkspacePath
        ? targetWorkspacePath.replace(/[\\/:*?"<>|]/g, '-')
        : (path.basename(path.dirname(dir)) || 'imported').replace(/[\\/:*?"<>|]/g, '_') || 'imported'
      let destId = id
      let destDir = path.join(sessionsRoot, sourceName, destId)
      let suffix = 1
      while (sessionIdExists(sessionsRoot, destId)) {
        destId = `${id}-imported-${suffix}`
        destDir = path.join(sessionsRoot, sourceName, destId)
        suffix += 1
      }
      fs.mkdirSync(destDir, { recursive: true })
      const files = standaloneFile ? [standaloneFile] : fs.readdirSync(dir)
      for (const f of files) {
        fs.copyFileSync(path.join(dir, f), path.join(destDir, f))
      }
      // 压缩格式适配：目标目录里的会话日志必须与 dsh 配置一致，否则服务无法启动
      await convertSessionDirEncoding(destDir, targetCompression)
      imported += 1
    }
    return { ok: true, count: imported }
  } catch (error) {
    return { ok: false, count: imported, error: `导入失败：${error instanceof Error ? error.message : String(error)}` }
  }
}
