/**
 * 工作文件夹的纯路径逻辑（不依赖 electron，可单测）。
 * electron 相关封装见 src/main/config.ts。
 */
import path from 'node:path'
import fs from 'node:fs'

/** 工作文件夹的一级子目录（规格第 2 节）。 */
export const WORKSPACE_DIRS = ['runtime', 'data', 'skills', 'plugins', 'config', 'backups', 'logs'] as const

/** runtime 下的运行时子目录。 */
export const RUNTIME_SUBDIRS = ['node', 'git', 'dsh'] as const

/** 应用配置文件相对工作文件夹的路径。 */
export const APP_CONFIG_REL = path.join('config', 'app.json')

/** 工作文件夹的默认位置：程序目录（打包后为 app 目录）的上一级下的 workspace/。 */
export function resolveDefaultWorkspaceDir(rootDir: string): string {
  return path.join(rootDir, 'workspace')
}

/** 安全读取 JSON 文件；不存在或解析失败返回 null。 */
export function readJsonFile(filePath: string): unknown | null {
  try {
    const text = fs.readFileSync(filePath, 'utf8')
    const parsed = JSON.parse(text)
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch {
    return null
  }
}

/**
 * 解析当前工作文件夹：
 * 1. 默认位置（rootDir/workspace）下的 config/app.json 若存在且声明了 workspacePath，则采用之（用户改过工作文件夹）；
 * 2. 否则使用默认位置。
 * 返回 { workspaceDir, config }，config 为 null 表示尚未初始化。
 */
export function resolveWorkspaceDir(
  rootDir: string
): { workspaceDir: string; config: Record<string, unknown> | null } {
  const defaultDir = resolveDefaultWorkspaceDir(rootDir)
  const config = readJsonFile(path.join(defaultDir, APP_CONFIG_REL)) as Record<string, unknown> | null
  const configured = config?.workspacePath
  if (typeof configured === 'string' && configured.trim().length > 0) {
    return { workspaceDir: path.resolve(configured), config }
  }
  return { workspaceDir: defaultDir, config }
}

/** 创建工作文件夹的完整目录骨架（幂等），返回本次新建的目录列表。 */
export function ensureWorkspaceLayout(workspaceDir: string): string[] {
  const created: string[] = []
  const mk = (dir: string): void => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
      created.push(dir)
    }
  }
  mk(workspaceDir)
  for (const sub of WORKSPACE_DIRS) {
    mk(path.join(workspaceDir, sub))
  }
  for (const sub of RUNTIME_SUBDIRS) {
    mk(path.join(workspaceDir, 'runtime', sub))
  }
  return created
}

/** 校验候选工作文件夹路径是否合法：必须为绝对路径、非驱动器根、可写。 */
export function validateWorkspacePath(
  input: string,
  extraForbidden?: string[]
): { ok: true; resolved: string } | { ok: false; error: string } {
  const trimmed = (input ?? '').trim()
  if (!trimmed) return { ok: false, error: '路径不能为空' }
  if (!path.isAbsolute(trimmed)) return { ok: false, error: '必须是绝对路径' }
  const resolved = path.resolve(trimmed)
  const parsed = path.parse(resolved)
  if (parsed.root === resolved) return { ok: false, error: '不能选择驱动器根目录（如 C:\\）' }
  if (extraForbidden && extraForbidden.some((f) => path.resolve(f) === resolved)) {
    return { ok: false, error: '该路径已被占用' }
  }
  const writable = probeWritable(resolved)
  if (!writable.ok) return { ok: false, error: writable.error }
  return { ok: true, resolved }
}

/** 探测目录是否可写（不存在则尝试创建）。 */
export function probeWritable(dir: string): { ok: true } | { ok: false; error: string } {
  try {
    fs.mkdirSync(dir, { recursive: true })
    const probe = path.join(dir, `.write-probe-${Date.now()}`)
    fs.writeFileSync(probe, 'probe')
    fs.unlinkSync(probe)
    return { ok: true }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (/EACCES|EPERM|EROFS/.test(message)) {
      return { ok: false, error: '目录无写入权限' }
    }
    return { ok: false, error: `路径不可用：${message}` }
  }
}

/** 原子写入 JSON（先写临时文件再重命名）。 */
export function writeJsonAtomic(filePath: string, value: unknown): void {
  const dir = path.dirname(filePath)
  fs.mkdirSync(dir, { recursive: true })
  const tmp = path.join(dir, `.tmp-${path.basename(filePath)}-${process.pid}-${Date.now()}`)
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8')
  try {
    fs.renameSync(tmp, filePath)
  } catch (error) {
    // Windows 下目标被占用时 rename 会失败，回退为直接覆盖
    try {
      fs.copyFileSync(tmp, filePath)
      fs.unlinkSync(tmp)
    } catch {
      throw error
    }
  }
}

/**
 * 按白名单过滤配置补丁（IPC 安全边界，纯函数可单测）。
 * 渲染进程只能写入白名单内的键；undefined 值忽略。
 */
export function filterConfigPatch(
  patch: Record<string, unknown> | undefined,
  whitelist: ReadonlySet<string>
): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  if (!patch || typeof patch !== 'object') return result
  for (const [key, value] of Object.entries(patch)) {
    if (!whitelist.has(key)) continue
    if (value === undefined) continue
    result[key] = value
  }
  return result
}
