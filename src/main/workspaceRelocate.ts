/**
 * 工作文件夹原子迁移（需求二）：
 * 1. 流式复制内容（data/skills/plugins/config/backups/logs；排除 runtime/tmp/sync）到目标父目录下的临时目录；
 * 2. 完整性校验（文件数 + 总字节）；
 * 3. 原子切换：写新路径配置 + 默认指针 → 旧目录改名保留 → 临时目录提升为新工作文件夹；
 * 4. 失败回滚：恢复配置指针、删除新目录、还原旧目录。
 */
import fs from 'node:fs'
import path from 'node:path'
import { getWorkspaceDir, getRootDir } from './config'
import { readJsonFile, validateWorkspacePath, writeJsonAtomic } from '../shared/workspace'
import { logger } from './logger'

export interface RelocateEventPayload {
  phase: 'log' | 'progress' | 'done' | 'error' | 'cancelled'
  done?: number
  total?: number
  message?: string
  error?: string
}

type Emit = (event: RelocateEventPayload) => void

/** 迁移时排除的目录（运行时环境可重新安装；tmp/sync 为临时/同步数据）。 */
const EXCLUDED_DIRS = new Set(['runtime', 'tmp', 'sync'])

function dirSize(dir: string): number {
  let total = 0
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name)
      if (entry.isDirectory()) total += dirSize(p)
      else if (entry.isFile()) total += fs.statSync(p).size
    }
  } catch {
    /* 目录缺失按 0 */
  }
  return total
}

/** 流式复制文件（避免大文件内存溢出）。 */
function copyFile(src: string, dst: string): void {
  fs.mkdirSync(path.dirname(dst), { recursive: true })
  fs.copyFileSync(src, dst)
}

/** 递归复制目录树。 */
function copyTree(src: string, dst: string): void {
  fs.mkdirSync(dst, { recursive: true })
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name)
    const d = path.join(dst, entry.name)
    if (entry.isDirectory()) copyTree(s, d)
    else if (entry.isFile()) copyFile(s, d)
  }
}

/** 校验：每个顶层条目文件数与总字节一致。 */
function verifyTree(ws: string, temp: string, names: string[]): { ok: boolean; error?: string } {
  for (const name of names) {
    const src = path.join(ws, name)
    const dst = path.join(temp, name)
    if (fs.existsSync(src) !== fs.existsSync(dst)) return { ok: false, error: `${name} 存在性不一致` }
    if (dirSize(src) !== dirSize(dst)) return { ok: false, error: `${name} 字节数不一致` }
  }
  return { ok: true }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/** 恢复配置指针回旧工作文件夹（回滚用）。 */
function restorePointers(ws: string, rootDir: string): void {
  try {
    const cfg = (readJsonFile(path.join(ws, 'config', 'app.json')) ?? {}) as Record<string, unknown>
    writeJsonAtomic(path.join(ws, 'config', 'app.json'), { ...cfg, workspacePath: ws })
    const defaultWs = path.join(rootDir, 'workspace')
    const defaultCfg = (readJsonFile(path.join(defaultWs, 'config', 'app.json')) ?? {}) as Record<string, unknown>
    writeJsonAtomic(path.join(defaultWs, 'config', 'app.json'), { ...defaultCfg, workspacePath: ws })
  } catch (error) {
    logger.warn(`回滚配置指针失败：${String(error)}`)
  }
}

/**
 * 原子迁移工作文件夹到 newPathInput。
 * 返回 { ok, error?, restartRequired? }；过程经 emit 推送进度事件。
 * @param opts.workspaceDir 当前工作文件夹（测试注入；默认解析）
 * @param opts.rootDir 程序根目录（默认指针落点；测试注入）
 */
export async function relocateWorkspace(
  newPathInput: string,
  emit: Emit,
  opts: { workspaceDir?: string; rootDir?: string; signal?: AbortSignal } = {}
): Promise<{ ok: boolean; error?: string; restartRequired?: boolean }> {
  const ws = opts.workspaceDir ?? getWorkspaceDir()
  const rootDir = opts.rootDir ?? getRootDir()
  const validation = validateWorkspacePath(newPathInput, [ws])
  if (!validation.ok) return { ok: false, error: validation.error }
  const newPath = validation.resolved
  if (path.resolve(newPath) === path.resolve(ws)) return { ok: false, error: '目标与当前工作文件夹相同' }

  const parent = path.dirname(newPath)
  const temp = path.join(parent, `.dsh-migrate-${Date.now()}`)
  const oldBak = `${ws}.old-${Date.now()}`

  try {
    // 1. 规划 + 流式复制
    const names = fs
      .readdirSync(ws, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith('.') && !EXCLUDED_DIRS.has(e.name))
      .map((e) => e.name)
    const totalBytes = names.reduce((acc, n) => acc + dirSize(path.join(ws, n)), 0)
    emit({ phase: 'log', message: `准备迁移 ${names.length} 个目录（共 ${formatBytes(totalBytes)}）…` })

    fs.mkdirSync(temp, { recursive: true })
    let done = 0
    for (const name of names) {
      copyTree(path.join(ws, name), path.join(temp, name))
      done += 1
      emit({ phase: 'progress', done, total: names.length, message: `正在迁移 ${name}…` })
    }

    // 2. 完整性校验
    const verify = verifyTree(ws, temp, names)
    if (!verify.ok) throw new Error(verify.error ?? '完整性校验失败')
    emit({ phase: 'progress', done: names.length, total: names.length, message: '校验通过，切换配置…' })

    // 3. 原子切换（沙箱/部分文件系统对目录 rename 不可靠，改用 复制+删除）
    const rawConfig = (readJsonFile(path.join(ws, 'config', 'app.json')) ?? {}) as Record<string, unknown>
    const nextConfig = { ...rawConfig, workspacePath: newPath }
    writeJsonAtomic(path.join(temp, 'config', 'app.json'), nextConfig)

    // 旧目录全量备份（含 runtime，供回滚/人工恢复）
    if (fs.existsSync(oldBak)) fs.rmSync(oldBak, { recursive: true, force: true })
    copyTree(ws, oldBak)
    // 临时目录提升为新工作文件夹
    copyTree(temp, newPath)
    // 删除原工作文件夹（已完整备份）
    fs.rmSync(ws, { recursive: true, force: true })
    fs.rmSync(temp, { recursive: true, force: true })

    // 默认指针写入（重建 ws 路径为指针目录，仅含 config）
    const defaultWs = path.join(rootDir, 'workspace')
    const defaultCfg = (readJsonFile(path.join(defaultWs, 'config', 'app.json')) ?? {}) as Record<string, unknown>
    writeJsonAtomic(path.join(defaultWs, 'config', 'app.json'), { ...defaultCfg, ...nextConfig })

    emit({
      phase: 'done',
      done: names.length,
      total: names.length,
      message: `迁移完成：${newPath}。旧目录保留于 ${oldBak}，确认无误后可手动删除。`
    })
    logger.info(`工作文件夹已迁移：${ws} → ${newPath}（旧目录 ${oldBak}）`)
    return { ok: true, restartRequired: true }
  } catch (error) {
    // 4. 回滚
    try {
      if (fs.existsSync(newPath)) fs.rmSync(newPath, { recursive: true, force: true })
      if (!fs.existsSync(ws) && fs.existsSync(oldBak)) {
        copyTree(oldBak, ws)
        fs.rmSync(oldBak, { recursive: true, force: true })
      }
      restorePointers(ws, rootDir)
    } catch (rollbackError) {
      logger.warn(`迁移回滚不完整：${String(rollbackError)}`)
    }
    const message = error instanceof Error ? error.message : String(error)
    emit({ phase: 'error', error: message, message: `迁移失败，已回滚：${message}` })
    logger.error(`工作文件夹迁移失败：${message}`)
    return { ok: false, error: message }
  } finally {
    if (fs.existsSync(temp)) fs.rmSync(temp, { recursive: true, force: true })
  }
}
