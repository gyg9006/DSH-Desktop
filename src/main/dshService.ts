/**
 * M4：dsh 服务生命周期管理（规格 4.5）：
 * - 启动前探测可用端口（被占用自动换端口，记录到 config）；
 * - 启动时清理上次残留的 dsh 子进程（按命令行特征匹配）；
 * - 应用退出时优雅关闭（正常终止，3 秒后强制 kill 进程树）；
 * - 每 5 秒 HTTP 探活，状态实时推送渲染层（绿=运行/灰=停止/红=异常）。
 */
import { spawn, type ChildProcess } from 'node:child_process'
import net from 'node:net'
import fs from 'node:fs'
import path from 'node:path'
import { logger } from './logger'
import { getWorkspaceDir, readAppConfig, updateAppConfig } from './config'
import { buildDshEnv } from './envCheck'
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
  /** 开机自动启动 dsh 服务（规格 6.14） */
  autoStart?: boolean
}

const HEALTH_INTERVAL_MS = 5000
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
  const match = dshDir.replace(/\\/g, '\\\\').replace(/'/g, "''")
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
  const nodeExe = path.join(workspaceDir, 'runtime', 'node', 'node.exe')
  const dshBin = path.join(workspaceDir, 'runtime', 'dsh', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
  if (!fs.existsSync(dshBin)) {
    return { ok: false, error: '未安装 DeepSeek Harness（dsh）。请在「设置 → 环境检测」中一键安装' }
  }
  if (!fs.existsSync(nodeExe)) {
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

  // 端口：auto 探测 / fixed 校验
  const config = readAppConfig()
  const svc = (config.service ?? {}) as ServiceConfig
  let port: number
  try {
    if (svc.portMode === 'fixed' && typeof svc.port === 'number' && svc.port > 0) {
      port = await probeFreePort(svc.port, 1)
      if (port !== svc.port) {
        return { ok: false, error: `端口 ${svc.port} 已被占用（可能是残留进程）。请先「清理残留进程」后重试，或改为自动探测` }
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
  // API 凭据不再注入环境变量：保存 API 配置时已写入 $DSH_HOME/.credentials.yaml
  // （dsh-credentials-local 受管文档，env > 文件 > .env，热重载），桌面端与 dsh Models 页
  // 共用同一份凭据，避免「输两遍」与 env 遮蔽文件编辑的问题。
  const apiConfig = readApiConfig()
  // 代理（规格 6.20：注入所有子进程 env）
  const proxy = buildProxyEnv(apiConfig)
  for (const [k, v] of Object.entries(proxy.vars)) env[k] = v
  for (const k of proxy.remove) delete env[k]

  // 启动参数（规格 6.11：默认 web，可追加）与 Node 选择（规格 6.15）
  const extraArgs = Array.isArray(svc.extraArgs) && svc.extraArgs.length > 0 ? svc.extraArgs : ['web']
  const runner = svc.useSystemNode === true ? 'node' : nodeExe
  const launchArgs = [dshBin, ...extraArgs, '--port', String(port)]
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
  const timeoutMs = svc.startupTimeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS
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
