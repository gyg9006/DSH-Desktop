/**
 * 环境解析器（P3 修复版）：三级优先级查找各运行时工具。
 *
 * 优先级（从高到低）：
 *   ① bundled  —— 客户端内置便携版（resources/portable-env/<key>/，随包分发，免下载）
 *   ② portable —— 工作文件夹下已安装的便携版（<workspace>/runtime/<key>/）
 *   ③ system   —— 系统 PATH 中已安装的版本
 *
 * 主进程启动时可调用 warmupEnvResolver() 预热缓存；检测/安装/服务启动统一走本模块，
 * 保证「内置优先」在检测面板、一键安装、dsh 服务启动三处行为一致。
 */
import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import type { EnvItemKey, EnvItemSource } from '../shared/ipc'

export interface EnvManifestEntry {
  version?: string
  /** 解压目录相对路径（内置目录形态，如 "node" / "git" / "pnpm" / "dsh-cli"） */
  dir?: string | null
  /** 可执行文件相对路径（node: "node.exe"；git: "cmd/git.exe"；pnpm: "pnpm.exe"） */
  exe?: string | null
  /** dsh 的 bin 相对路径（package.json bin 字段） */
  bin?: string | null
  /** 源归档名（保留记录，解压后已删除） */
  archive?: string
  sha256?: string
}

export interface EnvManifest {
  platform?: string
  arch?: string
  [key: string]: EnvManifestEntry | string | undefined
}

export interface ResolvedEnvTool {
  key: EnvItemKey
  /** 命中的来源：内置 / 工作区便携 / 系统 / 无 */
  source: EnvItemSource
  /** 可执行文件绝对路径（system 级为 PATH 命令名，如 "node"；none 为 null） */
  binPath: string | null
  /** 内置目录绝对路径（source=bundled 时可用） */
  bundledDir: string | null
  /** 校验/解析消息 */
  message?: string
}

/** 内置环境中各组件可执行文件相对路径（随平台）。 */
function exeRel(key: EnvItemKey, manifest: EnvManifest): string | null {
  const entry = manifest[key] as EnvManifestEntry | undefined
  if (!entry?.dir) return null
  if (key === 'dsh') return entry.bin ?? null
  if (entry.exe) return path.posix.join(entry.dir, entry.exe.replace(/\\/g, '/'))
  // 回退：按平台推导默认可执行名
  if (key === 'node') return path.posix.join(entry.dir, process.platform === 'win32' ? 'node.exe' : 'bin/node')
  if (key === 'git') return path.posix.join(entry.dir, process.platform === 'win32' ? 'cmd/git.exe' : 'bin/git')
  if (key === 'pnpm') return path.posix.join(entry.dir, process.platform === 'win32' ? 'pnpm.exe' : 'pnpm')
  return null
}

/**
 * 定位打包内置环境目录：
 * 1. 环境变量 DSH_PORTABLE_ENV_DIR（测试/自定义覆盖）；
 * 2. 打包后：<resources>/portable-env（extraResources 解包到 asar 外）；
 * 3. 开发时：<项目根>/resources/portable-env。
 */
export function portableEnvDir(): string | null {
  const override = process.env['DSH_PORTABLE_ENV_DIR']
  if (override && fs.existsSync(path.join(override, 'env-manifest.json'))) return override
  const candidates: string[] = []
  try {
    if (app.isPackaged && process.resourcesPath) candidates.push(path.join(process.resourcesPath, 'portable-env'))
    else candidates.push(path.join(app.getAppPath(), 'resources', 'portable-env'))
  } catch {
    /* electron app 未就绪（测试环境） */
  }
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, 'env-manifest.json'))) return dir
  }
  return null
}

/** 读取 env-manifest.json；缺失/损坏返回 null。 */
export function readEnvManifest(envDir: string | null): EnvManifest | null {
  if (!envDir) return null
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(envDir, 'env-manifest.json'), 'utf8')) as EnvManifest
    return raw && typeof raw === 'object' ? raw : null
  } catch {
    return null
  }
}

/** 内置环境中是否存在某组件的可执行文件（manifest 声明 + 文件真实存在）。 */
export function bundledToolPath(key: EnvItemKey): { abs: string; dir: string } | null {
  const envDir = portableEnvDir()
  const manifest = readEnvManifest(envDir)
  if (!envDir || !manifest) return null
  // 平台匹配：mac/linux 与 win 包互不通用
  if (manifest.platform && manifest.platform !== process.platform) return null
  const rel = exeRel(key, manifest)
  if (!rel) return null
  const abs = path.join(envDir, rel)
  if (!fs.existsSync(abs)) return null
  return { abs, dir: envDir }
}

/** 是否有任何内置便携环境（供 UI 切换「一键安装 → 启用内置环境」文案）。 */
export function hasBundledEnv(): boolean {
  const envDir = portableEnvDir()
  const manifest = readEnvManifest(envDir)
  if (!envDir || !manifest) return false
  return ['node', 'git', 'pnpm', 'dsh'].some((k) => bundledToolPath(k as EnvItemKey) !== null)
}

/** 工作区便携版路径（<workspace>/runtime/<key>）。 */
function portableToolPath(workspaceDir: string, key: EnvItemKey): string | null {
  const nodeRel = process.platform === 'win32' ? path.join('runtime', 'node', 'node.exe') : path.join('runtime', 'node', 'bin', 'node')
  const map: Record<EnvItemKey, string[]> = {
    node: [nodeRel],
    npm: [path.join('runtime', 'node', 'npm.cmd'), path.join('runtime', 'node', 'bin', 'npm')],
    pnpm: [path.join('runtime', 'node', 'pnpm.cmd'), path.join('runtime', 'pnpm', process.platform === 'win32' ? 'pnpm.exe' : 'pnpm')],
    git: [path.join('runtime', 'git', 'cmd', 'git.exe'), path.join('runtime', 'git', 'bin', 'git')],
    dsh: [path.join('runtime', 'dsh', 'node_modules', '@deepseek-ai', 'dsh', 'package.json')]
  }
  for (const rel of map[key]) {
    const abs = path.join(workspaceDir, rel)
    if (fs.existsSync(abs)) return abs
  }
  return null
}

/** PATH 中是否存在命令（仅 win32 检查常见扩展名）。 */
function systemCommandExists(command: string): boolean {
  const exts = process.platform === 'win32' ? ['', '.exe', '.cmd', '.bat'] : ['']
  for (const dir of (process.env.PATH ?? '').split(path.delimiter)) {
    if (!dir) continue
    for (const ext of exts) {
      const candidate = path.join(dir, command + ext)
      try {
        if (fs.statSync(candidate).isFile()) return true
      } catch {
        /* 继续 */
      }
    }
  }
  return false
}

const SYSTEM_COMMAND: Partial<Record<EnvItemKey, string>> = {
  node: 'node',
  npm: 'npm',
  pnpm: 'pnpm',
  git: 'git'
}

/**
 * 三级优先级解析某工具（内置 → 工作区 → 系统）。
 * dsh 无系统级（只能内置或工作区安装）。
 */
export function resolveEnvTool(workspaceDir: string, key: EnvItemKey): ResolvedEnvTool {
  // ① 内置
  const bundled = bundledToolPath(key)
  if (bundled) {
    return { key, source: 'bundled', binPath: bundled.abs, bundledDir: bundled.dir }
  }
  // ② 工作区便携
  const portable = portableToolPath(workspaceDir, key)
  if (portable) {
    return { key, source: 'portable', binPath: portable, bundledDir: null }
  }
  // ③ 系统
  const cmd = SYSTEM_COMMAND[key]
  if (cmd && systemCommandExists(cmd)) {
    return { key, source: 'system', binPath: cmd, bundledDir: null }
  }
  return { key, source: 'none', binPath: null, bundledDir: null, message: '未检测到' }
}
