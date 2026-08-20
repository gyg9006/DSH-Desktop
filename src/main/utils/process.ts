/**
 * 子进程执行工具：
 * - 全部系统命令经由 child_process 执行，检测类默认 30s、安装/更新类 600s 超时；
 * - 失败时输出可读的中文错误原因；
 * - 提供子进程环境构造（PATH 前置便携运行时目录 + DSH_HOME 等变量注入）。
 */
import { spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

export interface RunCommandOptions {
  command: string
  args?: string[]
  cwd?: string
  env?: NodeJS.ProcessEnv
  /** 超时毫秒数；超时后结束整个进程树。 */
  timeoutMs?: number
  onStdout?: (chunk: string) => void
  onStderr?: (chunk: string) => void
  /** 取消信号：abort 时结束整个进程树并返回 aborted。 */
  signal?: AbortSignal
}

export interface RunCommandResult {
  code: number | null
  stdout: string
  stderr: string
  timedOut: boolean
  /** 因取消信号而终止 */
  aborted?: boolean
  /** 失败时的可读中文原因（成功为 undefined）。 */
  error?: string
}

function isWindows(): boolean {
  return process.platform === 'win32'
}

/**
 * Windows 命令解析：spawn(shell:false) 不会按 PATHEXT 查找扩展名，
 * 裸命令 `npm` / `pnpm`（实为 .cmd 垫片）会 ENOENT。按 PATH 目录 + 常见扩展名
 * 解析出真实可执行文件；带扩展名 / 含路径分隔符 / 非 Windows 直接原样返回。
 * @param command 原始命令
 * @param pathEnv 用于解析的 PATH（默认 process.env.PATH；测试注入）
 */
export function resolveWindowsCommand(command: string, pathEnv: string = process.env.PATH ?? ''): string {
  if (!isWindows()) return command
  if (command.includes('/') || command.includes('\\')) return command
  if (/\.[a-zA-Z0-9]+$/.test(command)) return command
  const extensions = ['.cmd', '.bat', '.exe', '.com']
  for (const dir of pathEnv.split(path.delimiter)) {
    if (!dir) continue
    for (const ext of extensions) {
      const candidate = path.join(dir, command + ext)
      if (fs.existsSync(candidate)) return candidate
    }
  }
  return command
}

/** Windows 下 .cmd/.bat 直接 spawn 失败时的兜底：经 cmd.exe 执行。
 *  引号规则（已验证）：外层双引号包裹整条命令行，每个 token 单独加引号；
 *  /s 会先剥离外层引号，随后按普通 cmd 规则解析内部。 */
function spawnViaCmd(command: string, args: string[], opts: { cwd?: string; env?: NodeJS.ProcessEnv }): ReturnType<typeof spawn> {
  const quote = (s: string): string => `"${s}"`
  const inner = [quote(command), ...args.map(quote)].join(' ')
  const commandLine = `"${inner}"`
  return spawn('cmd.exe', ['/d', '/s', '/c', commandLine], {
    cwd: opts.cwd,
    env: opts.env,
    windowsHide: true,
    windowsVerbatimArguments: true
  })
}

/** 结束进程树（Windows 用 taskkill /T /F，其他平台逐级 kill）。 */
export function killProcessTree(pid: number): void {
  if (!pid || pid <= 0) return
  if (isWindows()) {
    try {
      const killer = spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
      killer.unref()
    } catch {
      try {
        process.kill(pid, 'SIGKILL')
      } catch {
        /* 进程可能已退出 */
      }
    }
    return
  }
  try {
    process.kill(-pid, 'SIGKILL')
  } catch {
    try {
      process.kill(pid, 'SIGKILL')
    } catch {
      /* 进程可能已退出 */
    }
  }
}

export function runCommand(options: RunCommandOptions): Promise<RunCommandResult> {
  const {
    command,
    args = [],
    cwd,
    env,
    timeoutMs = 30000,
    onStdout,
    onStderr,
    signal
  } = options

  return new Promise((resolve) => {
    let stdout = ''
    let stderr = ''
    let settled = false
    let timedOut = false
    let aborted = false

    const finish = (result: RunCommandResult): void => {
      if (settled) return
      settled = true
      signal?.removeEventListener('abort', onAbort)
      resolve(result)
    }

    let child: ChildProcess | null = null
    try {
      // Windows 下先解析 .cmd/.bat/.exe 真实路径，避免 npm/pnpm 等垫片 ENOENT
      const resolved = resolveWindowsCommand(command)
      child = spawn(resolved, args, { cwd, env, windowsHide: true, shell: false })
    } catch (error) {
      // 老版本 Node 直接 spawn .cmd/.bat 会抛 EINVAL，走 cmd.exe 兜底
      if (isWindows() && /\.(cmd|bat)$/i.test(command)) {
        try {
          child = spawnViaCmd(command, args, { cwd, env })
        } catch (inner) {
          const message = inner instanceof Error ? inner.message : String(inner)
          finish({ code: null, stdout, stderr, timedOut: false, error: `无法启动进程：${message}` })
          return
        }
      } else {
        const message = error instanceof Error ? error.message : String(error)
        finish({ code: null, stdout, stderr, timedOut: false, error: `无法启动进程：${message}` })
        return
      }
    }

    if (!child) {
      finish({ code: null, stdout, stderr, timedOut: false, error: `无法启动进程：${command}` })
      return
    }

    const timer = setTimeout(() => {
      timedOut = true
      if (child.pid) killProcessTree(child.pid)
    }, timeoutMs)

    const onAbort = (): void => {
      aborted = true
      if (child.pid) killProcessTree(child.pid)
    }
    if (signal) {
      if (signal.aborted) onAbort()
      else signal.addEventListener('abort', onAbort, { once: true })
    }

    child.on('error', (error: NodeJS.ErrnoException) => {
      let message: string
      if (error.code === 'ENOENT') {
        message = `未找到可执行文件：${command}（${error.message}）`
      } else if (error.code === 'EACCES' || error.code === 'EPERM') {
        message = `权限不足，无法执行：${command}`
      } else {
        message = `启动进程失败：${error.message}`
      }
      clearTimeout(timer)
      finish({ code: null, stdout, stderr, timedOut, error: message })
    })

    child.stdout?.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf8')
      stdout += text
      onStdout?.(text)
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf8')
      stderr += text
      onStderr?.(text)
    })

    child.on('close', (code) => {
      clearTimeout(timer)
      if (aborted) {
        finish({ code, stdout, stderr, timedOut: false, aborted: true })
        return
      }
      if (timedOut) {
        finish({
          code,
          stdout,
          stderr,
          timedOut: true,
          error: `命令执行超时（超过 ${Math.round(timeoutMs / 1000)} 秒）：${command}`
        })
        return
      }
      if (code !== 0) {
        const tail = stderr.trim().split('\n').slice(-5).join(' ').slice(0, 400)
        finish({
          code,
          stdout,
          stderr,
          timedOut: false,
          error: tail
            ? `命令执行失败（退出码 ${code}）：${command}。${tail}`
            : `命令执行失败（退出码 ${code}）：${command}`
        })
        return
      }
      finish({ code, stdout, stderr, timedOut: false })
    })
  })
}

/**
 * 构造子进程环境：把便携运行时目录注入 PATH 最前面，并注入额外变量。
 * 便携 Node 与 Git 目录不存在时自动忽略。
 */
export function buildChildEnv(
  workspaceDir: string,
  extraPathDirs: string[] = [],
  extraVars: Record<string, string> = {}
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env }
  const pathKey = Object.keys(env).find((k) => k.toLowerCase() === 'path') ?? 'Path'
  const candidates = [
    // 新布局：完整安装器落到工作区 env/；旧 runtime 作为兼容回退。
    path.join(workspaceDir, 'env', 'node'),
    path.join(workspaceDir, 'env', 'pnpm'),
    path.join(workspaceDir, 'env', 'git', 'cmd'),
    path.join(workspaceDir, 'env', 'git', 'bin'),
    path.join(workspaceDir, 'runtime', 'node'),
    path.join(workspaceDir, 'runtime', 'git', 'cmd'),
    ...extraPathDirs
  ].filter((dir) => fs.existsSync(dir))
  const existing = env[pathKey] ?? ''
  env[pathKey] = [...candidates, existing].filter((s) => s.length > 0).join(path.delimiter)
  for (const [key, value] of Object.entries(extraVars)) {
    if (value === undefined) continue
    // PATH 统一由上面的注入逻辑管理（大小写不敏感），避免被额外变量覆盖
    if (key.toLowerCase() === 'path') continue
    env[key] = value
  }
  return env
}
