/**
 * M4：dsh 服务生命周期管理（规格 4.5）：
 * - 启动前探测可用端口（被占用自动换端口，记录到 config）；
 * - 启动时清理上次残留的 dsh 子进程（按命令行特征匹配）；
 * - 应用退出时优雅关闭（正常终止，3 秒后强制 kill 进程树）；
 * - 每 5 秒 HTTP 探活，状态实时推送渲染层（绿=运行/灰=停止/红=异常）。
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import net from 'node:net'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { logger } from './logger'
import { getWorkspaceDir, readAppConfig, updateAppConfig } from './config'
import { buildDshEnv } from './envCheck'
import { resolveEnvTool, bundledToolPath } from './env-resolver'
import { runInstall, safeRemoveDir } from './installer'
import { runCommand, killProcessTree } from './utils/process'
import { readApiConfig, buildProxyEnv } from './apiConfig'
import { repairSessionEncodings } from './sessions'
import type { ServiceStatus } from '../shared/ipc'

export interface ServiceSnapshot {
  status: ServiceStatus
  port: number | null
  pid: number | null
  log: string[]
}

interface ServiceConfig {
  portMode?: 'auto' | 'fixed'
  port?: number
  startupTimeoutMs?: number
  lastPort?: number
  /** dsh 启动参数（默认 ['web']，可追加，规格 6.11） */
  extraArgs?: string[]
  /** 使用系统 Node 而非便携版（规格 6.15，默认关） */
  useSystemNode?: boolean
  /** 使用系统 dsh（npx/npm 全局安装）而非内置便携版；跳过自动启用内置（默认关） */
  useSystemDsh?: boolean
  /** 开机自动启动 dsh 服务（规格 6.14） */
  autoStart?: boolean
}

// C13：客户端每 30 秒探活 DSH，进程异常退出仍由 exit 事件立即标记 error。
const HEALTH_INTERVAL_MS = 30000
const STOP_GRACE_MS = 3000
const DEFAULT_STARTUP_TIMEOUT_MS = 60000
const MAX_LOG_LINES = 300

let child: ChildProcess | null = null
let status: ServiceStatus = 'stopped'
let currentPort: number | null = null
let healthTimer: NodeJS.Timeout | null = null
let logBuffer: string[] = []
let dshLogFile: string | null = null
/** 用户主动停止（区别于意外退出 → 异常） */
let stopRequested = false
let listener: ((snapshot: ServiceSnapshot) => void) | null = null

export function getServiceSnapshot(): ServiceSnapshot {
  return { status, port: currentPort, pid: child?.pid ?? null, log: [...logBuffer] }
}

export function onServiceStatusChange(cb: (snapshot: ServiceSnapshot) => void): void {
  listener = cb
}

function emit(): void {
  listener?.(getServiceSnapshot())
}

function pushLog(line: string): void {
  const trimmed = line.replace(/\r?\n$/, '')
  if (!trimmed) return
  const stamp = new Date().toISOString().slice(11, 19)
  const full = `[${stamp}] ${trimmed}`
  logBuffer.push(full)
  if (logBuffer.length > MAX_LOG_LINES) logBuffer.splice(0, logBuffer.length - MAX_LOG_LINES)
  if (dshLogFile) {
    try {
      fs.appendFileSync(dshLogFile, full + '\n', 'utf8')
    } catch {
      /* 忽略 */
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// ---------------------------------------------------------------------------
// 端口探测（规格 4.5 / 测试覆盖要求）
// ---------------------------------------------------------------------------

/** 动态解析 dsh 启动入口：读包 package.json 的 bin 字段（dsh 升级改结构后仍可用）。 */
export function resolveDshBin(workspaceDir: string): string | null {
  const pkgPath = path.join(workspaceDir, 'runtime', 'dsh', 'node_modules', '@deepseek-ai', 'dsh', 'package.json')
  try {
    if (!fs.existsSync(pkgPath)) return null
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as { bin?: string | Record<string, string> }
    const bin = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin?.dsh
    if (!bin) return null
    const candidate = path.join(path.dirname(pkgPath), bin)
    return fs.existsSync(candidate) ? candidate : null
  } catch {
    return null
  }
}

/** 从 fromDir 向上沿 node_modules 链解析依赖是否存在。 */
function resolveDependency(fromDir: string, dep: string): boolean {
  let dir = fromDir
  for (;;) {
    if (fs.existsSync(path.join(dir, 'node_modules', dep))) return true
    const parent = path.dirname(dir)
    if (parent === dir) return false
    dir = parent
  }
}

/** 清理本工作区 runtime 下残留的 node/npm 进程（中断的 npm install 等），避免目录删除 EPERM。 */
async function cleanupRuntimeNode(workspaceDir: string): Promise<number> {
  const runtimePath = path.join(workspaceDir, 'runtime')
  if (!fs.existsSync(path.join(runtimePath, 'dsh'))) return 0
  // PowerShell -like 模式：只转义单引号；反斜杠是字面（PowerShell 不做 \ 转义）
  const match = runtimePath.replace(/'/g, "''")
  const script = [
    "Get-CimInstance Win32_Process -Filter \"name = 'node.exe'\"",
    `| Where-Object { $_.CommandLine -and $_.CommandLine -like '*${match}*' -and $_.CommandLine -notlike '*npm-cache*' }`,
    '| ForEach-Object { $_.ProcessId }'
  ].join(' ')
  const result = await runCommand({
    command: 'powershell.exe',
    args: ['-NoProfile', '-NonInteractive', '-EncodedCommand', psEncoded(script)],
    timeoutMs: 15000
  })
  if (result.error) return 0
  const pids = result.stdout
    .split(/\s+/)
    .map((s) => Number.parseInt(s, 10))
    .filter((n) => Number.isInteger(n) && n > 0 && n !== process.pid)
  let killed = 0
  for (const pid of pids) {
    if (child && pid === child.pid) continue
    try {
      killProcessTree(pid)
      killed += 1
    } catch {
      /* 进程可能已退出 */
    }
  }
  if (killed > 0) pushLog(`已清理 ${killed} 个残留运行时进程（中断的安装任务）`)
  return killed
}

/**
 * 检测工作区 dsh 安装是否损坏（历史 symlink 安装无依赖 / 依赖缺失）。
 * 损坏时启动服务会自动清理重装（复制 + 包内 npm install）。
 * 核心检查：bin.js 直接依赖 @deepseek-ai/dsh-app-boot 必须可解析
 * （此前只抽查前 3 个依赖，网络中断的安装会留下「主包在、依赖空」的假完整状态）。
 */
export function dshInstallBroken(workspaceDir: string): boolean {
  const pkgDir = path.join(workspaceDir, 'runtime', 'dsh', 'node_modules', '@deepseek-ai', 'dsh')
  const pkgPath = path.join(pkgDir, 'package.json')
  // 先检测 symlink/junction（v2.1.3 的 file:link 安装产物）——existsSync 会跟随链接，
  // 空链接目标会被误判为"未安装"，必须用 lstatSync 先查
  try {
    if (fs.lstatSync(pkgDir).isSymbolicLink()) return true
  } catch {
    return false // 目录不存在 → 未安装（走自动启用分支）
  }
  if (!fs.existsSync(pkgPath)) return false
  // bin.js 首行 import 的启动必需依赖；缺失则 dsh 秒退（ERR_MODULE_NOT_FOUND）
  const critical = '@deepseek-ai/dsh-app-boot'
  if (!resolveDependency(pkgDir, critical)) return true
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as { dependencies?: Record<string, string> }
    const deps = Object.keys(pkg.dependencies ?? {})
    if (deps.length === 0) return true
  } catch {
    return true
  }
  return false
}

/** 从 dsh 包的 package.json 解析 bin 入口（存在性校验）。 */
function binFromPkg(pkgPath: string): string | null {
  try {
    if (!fs.existsSync(pkgPath)) return null
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as { bin?: string | Record<string, string> }
    const bin = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin?.dsh
    if (!bin) return null
    const candidate = path.join(path.dirname(pkgPath), bin)
    return fs.existsSync(candidate) ? candidate : null
  } catch {
    return null
  }
}

/** npm cache 目录：npm config get cache（cmd 包装，Windows .cmd 不能直接 spawn）。 */
function npmCacheDir(): string {
  try {
    const r = spawnSync('cmd', ['/d', '/s', '/c', 'npm config get cache'], { encoding: 'utf8', timeout: 20000, windowsHide: true })
    const out = String(r.stdout ?? '').trim()
    if (r.status === 0 && out) return out
  } catch {
    /* 忽略 */
  }
  const local = process.env.LOCALAPPDATA
  if (local) {
    const p = path.join(local, 'npm-cache')
    if (fs.existsSync(p)) return p
  }
  return path.join(os.homedir(), '.npm')
}

/**
 * 解析系统 dsh（正常版）入口：
 * 1. npm 全局根（npm root -g 下的 @deepseek-ai/dsh）；
 * 2. npx 缓存（<npm cache>/_npx/<hash>/node_modules/@deepseek-ai/dsh，取最新）。
 */
export function resolveSystemDshBin(): string | null {
  try {
    const r = spawnSync('cmd', ['/d', '/s', '/c', 'npm root -g'], { encoding: 'utf8', timeout: 20000, windowsHide: true })
    if (r.status === 0) {
      const root = String(r.stdout).trim()
      const bin = binFromPkg(path.join(root, '@deepseek-ai', 'dsh', 'package.json'))
      if (bin) return bin
    }
  } catch {
    /* 忽略 */
  }
  try {
    const npxRoot = path.join(npmCacheDir(), '_npx')
    if (fs.existsSync(npxRoot)) {
      let best: { mtime: number; bin: string } | null = null
      for (const e of fs.readdirSync(npxRoot, { withFileTypes: true })) {
        if (!e.isDirectory()) continue
        const pkgPath = path.join(npxRoot, e.name, 'node_modules', '@deepseek-ai', 'dsh', 'package.json')
        const bin = binFromPkg(pkgPath)
        if (bin) {
          const mtime = fs.statSync(path.join(npxRoot, e.name)).mtimeMs
          if (!best || mtime > best.mtime) best = { mtime, bin }
        }
      }
      if (best) return best.bin
    }
  } catch {
    /* 忽略 */
  }
  return null
}

/** 从 start 起探测第一个空闲端口（127.0.0.1）。 */
export function probeFreePort(start = 3080, tries = 100): Promise<number> {
  return new Promise((resolve, reject) => {
    const attempt = (port: number): void => {
      if (tries-- <= 0) {
        reject(new Error('未找到可用端口'))
        return
      }
      const server = net.createServer()
      server.once('error', () => {
        server.close()
        attempt(port + 1)
      })
      server.listen(port, '127.0.0.1', () => {
        const actual = (server.address() as net.AddressInfo).port
        server.close(() => resolve(actual))
      })
    }
    attempt(start)
  })
}

/** HTTP 探活 dsh 服务。 */
export async function isPortHealthy(port: number, timeoutMs = 2000): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(timeoutMs) })
    return res.ok
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// 残留进程清理
// ---------------------------------------------------------------------------

/** PowerShell -EncodedCommand 构造（避免引号地狱）。 */
function psEncoded(script: string): string {
  return Buffer.from(script, 'utf16le').toString('base64')
}

/** 清理上次残留的 dsh 子进程。
 *  只匹配本工作区 runtime\dsh 的进程（按命令行特征），绝不清理外部 dsh——
 *  用户在浏览器/命令行里单独启动的 dsh web 属于独立实例，桌面端无权终止。 */
export async function cleanupStaleDsh(): Promise<number> {
  const workspaceDir = getWorkspaceDir()
  const dshDir = path.join(workspaceDir, 'runtime', 'dsh')
  if (!fs.existsSync(path.join(dshDir, 'node_modules', '@deepseek-ai', 'dsh'))) return 0
  // 命令行含本工作区 runtime\dsh\...\bin.js（注意：不匹配 npm-cache/_npx 等外部路径）
  const match = dshDir.replace(/'/g, "''")
  const script = [
    "Get-CimInstance Win32_Process -Filter \"name = 'node.exe'\"",
    `| Where-Object { $_.CommandLine -and $_.CommandLine -like '*${match}*bin.js*' }`,
    '| ForEach-Object { $_.ProcessId }'
  ].join(' ')
  const result = await runCommand({
    command: 'powershell.exe',
    args: ['-NoProfile', '-NonInteractive', '-EncodedCommand', psEncoded(script)],
    timeoutMs: 15000
  })
  if (result.error) {
    logger.warn(`残留进程扫描失败：${result.error}`)
    return 0
  }
  const pids = result.stdout
    .split(/\s+/)
    .map((s) => Number.parseInt(s, 10))
    .filter((n) => Number.isInteger(n) && n > 0)
  let cleaned = 0
  for (const pid of pids) {
    if (pid === process.pid) continue
    // 排除本应用当前运行的 dsh 服务进程（child），避免误杀正在服务的进程
    if (child && pid === child.pid) continue
    try {
      killProcessTree(pid)
      logger.info(`已清理残留 dsh 进程：PID ${pid}`)
      cleaned += 1
    } catch {
      /* 进程可能已退出 */
    }
  }
  return cleaned
}

// ---------------------------------------------------------------------------
// 启动 / 停止 / 探活
// ---------------------------------------------------------------------------

export async function startDshService(): Promise<{ ok: boolean; port?: number; error?: string }> {
  if (status === 'starting' || status === 'running') {
    return { ok: false, error: '服务已在运行' }
  }
  const workspaceDir = getWorkspaceDir()
  const config = readAppConfig()
  const svc = (config.service ?? {}) as ServiceConfig
  // dsh 启动入口动态解析（版本升级兼容）：读取 dsh 包 package.json 的 bin 字段，
  // 避免硬编码 lib/bin.js 在 dsh 升级改包结构后失效。
  let dshBin = resolveDshBin(workspaceDir)
  let dshSource: 'system' | 'portable' | 'bundled' | null = null
  if (svc.useSystemDsh === true) {
    // 使用系统 dsh（正常版，npx/npm 全局安装）：不自动启用内置便携版
    dshBin = resolveSystemDshBin()
    dshSource = dshBin ? 'system' : null
    if (!dshBin) {
      return { ok: false, error: '未找到系统 dsh（请先执行 npm install -g @deepseek-ai/dsh，或确认 npx 可找到该包）' }
    }
  } else {
    if (dshBin && dshInstallBroken(workspaceDir)) {
      // 历史坏安装：v2.1.3 的 npm install <dir> --prefix 是 file:link 语义（symlink 指向内置且不装依赖）
      // → 启动即 ERR_MODULE_NOT_FOUND。自动清掉并重新启用（复制 + 包内 npm install 装依赖）
      pushLog('检测到 dsh 安装不完整（历史 symlink 安装），正在重新启用内置 dsh…')
      // 先清理残留的 npm/node 进程（中断的安装任务会持有目录句柄导致删除 EPERM）
      await cleanupRuntimeNode(workspaceDir)
      await sleep(1000)
      safeRemoveDir(path.join(workspaceDir, 'runtime', 'dsh'))
      dshBin = null
    }
    if (!dshBin && bundledToolPath('dsh')) {
      // 内置 dsh 可用但未安装到工作区 → 自动启用（内置主包 + 依赖安装，免手动一键安装）。
      // 依赖安装需联网下载（约 1-3 分钟），先进入 starting 状态给用户明确进度反馈，
      // 避免 UI 停留在「已停止」且 60 秒启动超时误报。
      status = 'starting'
      currentPort = null
      emit()
      pushLog('检测到内置 dsh，正在自动启用：安装依赖需要联网下载，首次约 1-3 分钟，请稍候…')
      const inst = await runInstall(workspaceDir, 'dsh', 'install', {
        log: (m) => pushLog(m),
        progress: () => undefined
      })
      if (!inst.ok) {
        status = 'stopped'
        emit()
        return { ok: false, error: `内置 dsh 自动启用失败：${inst.error ?? '未知错误'}（可稍后在「设置 → 环境检测」中手动重试）` }
      }
      dshBin = resolveDshBin(workspaceDir)
      dshSource = 'portable'
    } else if (dshBin) {
      dshSource = 'portable'
    }
  }
  if (!dshBin) {
    return { ok: false, error: '未安装 DeepSeek Harness（dsh）。请在「设置 → 环境检测」中一键安装' }
  }
  // Node 解析（规格 6.15 + P3 修复）：useSystemNode 显式优先；
  // 否则按 env-resolver 三级：内置便携（resources/portable-env/node）→ 工作区便携 → 系统
  const nodeTool = resolveEnvTool(workspaceDir, 'node')
  let nodeRunner: string
  if (svc.useSystemNode === true || dshSource === 'system') nodeRunner = 'node'
  else if (nodeTool.source === 'bundled' || nodeTool.source === 'portable') nodeRunner = nodeTool.binPath!
  else if (nodeTool.source === 'system') nodeRunner = 'node'
  else {
    return { ok: false, error: '未安装便携 Node.js。请在「设置 → 环境检测」中一键安装' }
  }

  // 清理上次残留（避免僵尸进程与端口占用）
  const cleaned = await cleanupStaleDsh()
  if (cleaned > 0) pushLog(`已清理残留 dsh 进程 ${cleaned} 个`)

  // 会话编码修复：dsh 启动时会全根校验压缩格式，格式不符直接抛错。
  // 此处把任何来源导入的会话（.jsonl / .jsonl.zstd）统一转换为当前配置格式，保证服务可启动。
  try {
    const { fixed, target } = await repairSessionEncodings(workspaceDir)
    if (fixed > 0) pushLog(`已自动修复 ${fixed} 个会话的存储格式（${target === 'zstd' ? 'zstd 压缩' : '未压缩'}）`)
  } catch (error) {
    pushLog(`会话格式检查失败：${error instanceof Error ? error.message : String(error)}`)
  }

  // 端口：auto 探测 / fixed 校验（被占用时自动顺延到下一个空闲端口）
  let port: number
  try {
    if (svc.portMode === 'fixed' && typeof svc.port === 'number' && svc.port > 0) {
      // 从目标端口起完整探测：目标被占则自动顺延（不再报错）
      port = await probeFreePort(svc.port)
      if (port !== svc.port) {
        pushLog(`端口 ${svc.port} 已被占用，已自动顺延到 ${port}`)
      }
    } else {
      port = await probeFreePort(3080)
    }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
  updateAppConfig({ service: { ...svc, lastPort: port } })

  status = 'starting'
  currentPort = port
  dshLogFile = path.join(workspaceDir, 'logs', 'dsh.log')
  fs.mkdirSync(path.dirname(dshLogFile), { recursive: true })
  pushLog(`正在启动 dsh web（端口 ${port}）…`)
  emit()

  const env = buildDshEnv(workspaceDir)
  // API Key、模型和代理由 DSH 原生服务读取工作目录配置；客户端只负责生命周期。
  const apiConfig = readApiConfig()
  // 代理（规格 6.20：注入所有子进程 env）
  const proxy = buildProxyEnv(apiConfig)
  for (const [k, v] of Object.entries(proxy.vars)) env[k] = v
  for (const k of proxy.remove) delete env[k]

  // 启动参数（规格 6.11：默认 web，可追加）与 Node 选择（规格 6.15 + 内置/工作区/系统三级）
  const extraArgs = Array.isArray(svc.extraArgs) && svc.extraArgs.length > 0 ? svc.extraArgs : ['web']
  const runner = nodeRunner
  // DSH 必须嵌入客户端 webview，禁止 dsh 自动打开系统浏览器。
  const launchArgs = [dshBin, ...extraArgs.filter((arg) => arg !== '--open' && arg !== '--no-open'), '--no-open', '--port', String(port)]
  pushLog(`启动命令：${runner} ${launchArgs.join(' ')}`)

  child = spawn(runner, launchArgs, {
    cwd: workspaceDir,
    env,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe']
  })
  child.stdout?.on('data', (chunk: Buffer) => {
    pushLog(chunk.toString('utf8'))
    emit()
  })
  child.stderr?.on('data', (chunk: Buffer) => {
    pushLog(chunk.toString('utf8'))
    emit()
  })
  child.on('exit', (code, signal) => {
    pushLog(`dsh 进程已退出（code=${code ?? 'null'}${signal ? `, signal=${signal}` : ''}）`)
    child = null
    // 区分：用户主动停止 → 已停止（灰）；意外退出 → 异常（红，规格 4.5 状态灯）
    if (!stopRequested) {
      pushLog('dsh 进程意外退出，服务异常')
      status = 'error'
    } else {
      status = 'stopped'
    }
    stopRequested = false
    emit()
  })

  // 等待服务就绪（超时时间可配置，规格 6.13）
  // 配置存储单位为秒（UI 标签「启动超时时间（秒）」），此处换算为毫秒
  const timeoutMs = (svc.startupTimeoutMs && svc.startupTimeoutMs > 0 ? svc.startupTimeoutMs : DEFAULT_STARTUP_TIMEOUT_MS / 1000) * 1000
  const deadline = Date.now() + timeoutMs
  let ready = false
  while (Date.now() < deadline && child) {
    if (await isPortHealthy(port)) {
      ready = true
      break
    }
    await sleep(500)
  }

  if (ready) {
    status = 'running'
    pushLog(`dsh web 就绪：http://127.0.0.1:${port}`)
    startHealthTimer()
    emit()
    logger.info(`dsh 服务已启动：端口 ${port}`)
    return { ok: true, port }
  }

  status = 'error'
  emit()
  void stopDshService()
  return { ok: false, error: '服务启动超时，请查看启动日志后重试' }
}

export async function stopDshService(): Promise<{ ok: boolean }> {
  stopHealthTimer()
  const c = child
  if (!c) {
    stopRequested = false
    status = 'stopped'
    emit()
    return { ok: true }
  }
  const pid = c.pid
  stopRequested = true
  pushLog('正在停止 dsh 服务…')
  // 正常终止
  try {
    c.kill('SIGTERM')
  } catch {
    /* 忽略 */
  }
  // 3 秒宽限期后强制结束进程树
  const forceTimer = setTimeout(() => {
    if (child === c && pid) {
      pushLog('未能在宽限期内退出，强制结束进程树…')
      killProcessTree(pid)
    }
  }, STOP_GRACE_MS)
  await new Promise<void>((resolve) => {
    const hard = setTimeout(resolve, STOP_GRACE_MS + 3000)
    c.once('exit', () => {
      clearTimeout(hard)
      clearTimeout(forceTimer)
      resolve()
    })
  })
  status = 'stopped'
  emit()
  logger.info('dsh 服务已停止')
  return { ok: true }
}

function startHealthTimer(): void {
  stopHealthTimer()
  healthTimer = setInterval(() => {
    if (!currentPort) return
    void (async () => {
      const ok = await isPortHealthy(currentPort!)
      if (ok && status === 'error') {
        status = 'running'
        emit()
      } else if (!ok && status === 'running') {
        status = 'error'
        pushLog('服务探活失败（HTTP 无响应）')
        emit()
      }
    })()
  }, HEALTH_INTERVAL_MS)
}

function stopHealthTimer(): void {
  if (healthTimer) {
    clearInterval(healthTimer)
    healthTimer = null
  }
}

export function isServiceRunning(): boolean {
  return status === 'running'
}

export function isServiceChild(pid: number): boolean {
  return child?.pid === pid
}
