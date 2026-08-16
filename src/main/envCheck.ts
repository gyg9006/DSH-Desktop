/**
 * 环境检测（M1 提供基础版本检测；M2 增加一键安装/更新）。
 * 便携版优先，其次系统版本；dsh 从 runtime/dsh 的 package.json 读取版本。
 */
import fs from 'node:fs'
import path from 'node:path'
import { runCommand, buildChildEnv } from './utils/process'
import { isNodeVersionCompatible } from '../shared/version'
import type { EnvItem, EnvItemKey, EnvItemState, EnvReport } from '../shared/ipc'

const DETECT_TIMEOUT_MS = 30000

/**
 * 便携运行时子进程环境：npm 缓存与 corepack 缓存均收敛到工作文件夹
 * （检测与安装/更新必须使用同一套环境，否则 corepack 会把 pnpm 下载到系统目录）。
 */
export function buildRuntimeEnv(workspaceDir: string): NodeJS.ProcessEnv {
  return buildChildEnv(workspaceDir, [], {
    npm_config_cache: path.join(workspaceDir, 'runtime', '.npm-cache'),
    COREPACK_HOME: path.join(workspaceDir, 'runtime', 'node', '.corepack')
  })
}

function makeItem(
  key: EnvItemKey,
  name: string,
  state: EnvItemState,
  version: string | null,
  source: EnvItem['source'],
  message?: string
): EnvItem {
  return { key, name, state, version, source, message }
}

async function detectNode(workspaceDir: string): Promise<EnvItem> {
  const portable = path.join(workspaceDir, 'runtime', 'node', 'node.exe')
  if (fs.existsSync(portable)) {
    const result = await runCommand({
      command: portable,
      args: ['--version'],
      timeoutMs: DETECT_TIMEOUT_MS
    })
    if (result.error) return makeItem('node', 'Node.js', 'error', null, 'portable', result.error)
    const version = result.stdout.trim()
    return makeItem(
      'node',
      'Node.js',
      isNodeVersionCompatible(version) ? 'ok' : 'incompatible',
      version,
      'portable',
      isNodeVersionCompatible(version) ? undefined : '版本低于 18（不支持）'
    )
  }
  const result = await runCommand({
    command: 'node',
    args: ['--version'],
    timeoutMs: DETECT_TIMEOUT_MS
  })
  if (result.error) {
    return makeItem('node', 'Node.js', 'missing', null, 'none', '未检测到便携版或系统 Node.js')
  }
  const version = result.stdout.trim()
  return makeItem(
    'node',
    'Node.js',
    isNodeVersionCompatible(version) ? 'ok' : 'incompatible',
    version,
    'system',
    isNodeVersionCompatible(version) ? undefined : '版本低于 18（不支持）'
  )
}

async function detectNpm(workspaceDir: string): Promise<EnvItem> {
  const portable = path.join(workspaceDir, 'runtime', 'node', 'npm.cmd')
  if (fs.existsSync(portable)) {
    const result = await runCommand({
      command: portable,
      args: ['--version'],
      timeoutMs: DETECT_TIMEOUT_MS,
      env: buildRuntimeEnv(workspaceDir)
    })
    if (result.error) return makeItem('npm', 'npm', 'error', null, 'portable', result.error)
    return makeItem('npm', 'npm', 'ok', result.stdout.trim(), 'portable')
  }
  const result = await runCommand({ command: 'npm', args: ['--version'], timeoutMs: DETECT_TIMEOUT_MS })
  if (result.error) return makeItem('npm', 'npm', 'missing', null, 'none', 'npm 随 Node.js 提供，尚未安装')
  return makeItem('npm', 'npm', 'ok', result.stdout.trim(), 'system')
}

async function detectPnpm(workspaceDir: string): Promise<EnvItem> {
  const portable = path.join(workspaceDir, 'runtime', 'node', 'pnpm.cmd')
  if (fs.existsSync(portable)) {
    const result = await runCommand({
      command: portable,
      args: ['--version'],
      timeoutMs: DETECT_TIMEOUT_MS,
      env: buildRuntimeEnv(workspaceDir)
    })
    if (result.error) return makeItem('pnpm', 'pnpm', 'error', null, 'portable', result.error)
    return makeItem('pnpm', 'pnpm', 'ok', result.stdout.trim(), 'portable')
  }
  const result = await runCommand({ command: 'pnpm', args: ['--version'], timeoutMs: DETECT_TIMEOUT_MS })
  if (result.error) return makeItem('pnpm', 'pnpm', 'missing', null, 'none', '未安装（可一键安装，经便携 Node 的 corepack 启用）')
  return makeItem('pnpm', 'pnpm', 'ok', result.stdout.trim(), 'system')
}

async function detectGit(workspaceDir: string): Promise<EnvItem> {
  const portable = path.join(workspaceDir, 'runtime', 'git', 'cmd', 'git.exe')
  if (fs.existsSync(portable)) {
    const result = await runCommand({ command: portable, args: ['--version'], timeoutMs: DETECT_TIMEOUT_MS })
    if (result.error) return makeItem('git', 'Git', 'error', null, 'portable', result.error)
    return makeItem('git', 'Git', 'ok', result.stdout.trim(), 'portable')
  }
  const result = await runCommand({ command: 'git', args: ['--version'], timeoutMs: DETECT_TIMEOUT_MS })
  if (result.error) return makeItem('git', 'Git', 'missing', null, 'none', '未检测到便携版或系统 Git')
  return makeItem('git', 'Git', 'ok', result.stdout.trim(), 'system')
}

function detectDsh(workspaceDir: string): EnvItem {
  const pkgPath = path.join(workspaceDir, 'runtime', 'dsh', 'node_modules', '@deepseek-ai', 'dsh', 'package.json')
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as { version?: string }
    if (!pkg.version) return makeItem('dsh', 'DeepSeek Harness', 'error', null, 'portable', 'package.json 缺少 version 字段')
    return makeItem('dsh', 'DeepSeek Harness (dsh)', 'ok', `v${pkg.version}`, 'portable')
  } catch {
    return makeItem('dsh', 'DeepSeek Harness (dsh)', 'missing', null, 'none', '未安装（M2 提供一键安装）')
  }
}

export async function detectEnv(workspaceDir: string): Promise<EnvReport> {
  const items = await Promise.all([
    detectNode(workspaceDir),
    detectNpm(workspaceDir),
    detectPnpm(workspaceDir),
    detectGit(workspaceDir),
    Promise.resolve(detectDsh(workspaceDir))
  ])
  const summary = items.reduce(
    (acc, item) => {
      acc[item.state] += 1
      return acc
    },
    { ok: 0, missing: 0, incompatible: 0, error: 0 }
  )
  return { items, checkedAt: new Date().toISOString(), summary }
}

/** 供 M4 之后使用的子进程环境（PATH 前置便携运行时 + dsh 数据目录注入）。 */
export function buildDshEnv(workspaceDir: string, extraVars: Record<string, string> = {}): NodeJS.ProcessEnv {
  return buildChildEnv(workspaceDir, [], {
    DSH_HOME: path.join(workspaceDir, 'data'),
    DSH_TELEMETRY_DISABLED: '1',
    ...extraVars
  })
}
