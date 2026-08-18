/**
 * 环境检测（M1 提供基础版本检测；M2 增加一键安装/更新；P3 修复：三来源检测）。
 * 检测顺序统一走 env-resolver 三级优先级：内置便携版(bundled) → 工作区便携版(portable) → 系统(system)。
 * dsh 从内置 dsh-cli 或 runtime/dsh 的 package.json 读取版本。
 */
import fs from 'node:fs'
import path from 'node:path'
import { runCommand, buildChildEnv } from './utils/process'
import { isNodeVersionCompatible } from '../shared/version'
import { resolveEnvTool, bundledToolPath, readEnvManifest } from './env-resolver'
import type { EnvItem, EnvItemKey, EnvItemSource, EnvItemState, EnvReport } from '../shared/ipc'

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
  source: EnvItemSource,
  message?: string,
  bundledAvailable?: boolean
): EnvItem {
  return { key, name, state, version, source, message, bundledAvailable }
}

/** 执行可执行文件并返回 stdout 首行（trim）；异常返回 null。 */
async function runVersion(execPath: string, args: string[], env?: NodeJS.ProcessEnv): Promise<string | null> {
  const result = await runCommand({ command: execPath, args, timeoutMs: DETECT_TIMEOUT_MS, env })
  return result.error ? null : result.stdout.trim()
}

async function detectNode(workspaceDir: string): Promise<EnvItem> {
  const tool = resolveEnvTool(workspaceDir, 'node')
  const ba = bundledToolPath('node') !== null
  if (tool.source === 'bundled' || tool.source === 'portable') {
    const version = await runVersion(tool.binPath!, ['--version'])
    if (version === null) {
      return makeItem('node', 'Node.js', 'error', null, tool.source, `执行失败：${tool.binPath}（可能缺少 VC++ 运行库或文件损坏）`, ba)
    }
    return makeItem(
      'node',
      'Node.js',
      isNodeVersionCompatible(version) ? 'ok' : 'incompatible',
      version,
      tool.source,
      isNodeVersionCompatible(version)
        ? undefined
        : tool.source === 'bundled'
          ? '版本低于 18（不支持），请更新内置环境'
          : '版本低于 18（不支持）',
      ba
    )
  }
  if (tool.source === 'system') {
    const version = await runVersion('node', ['--version'])
    if (version === null) return makeItem('node', 'Node.js', 'missing', null, 'none', '未检测到系统 Node.js', ba)
    return makeItem(
      'node',
      'Node.js',
      isNodeVersionCompatible(version) ? 'ok' : 'incompatible',
      version,
      'system',
      isNodeVersionCompatible(version) ? undefined : '版本低于 18（不支持）',
      ba
    )
  }
  return makeItem('node', 'Node.js', 'missing', null, 'none', '未检测到内置、便携版或系统 Node.js', ba)
}

async function detectNpm(workspaceDir: string): Promise<EnvItem> {
  const tool = resolveEnvTool(workspaceDir, 'npm')
  // npm 无独立内置包：内置 Node 自带 npm，故 bundledAvailable 视内置 Node 而定
  const ba = bundledToolPath('node') !== null
  if (tool.source === 'portable' || tool.source === 'system') {
    const version = await runVersion(tool.binPath!, ['--version'], buildRuntimeEnv(workspaceDir))
    if (version === null) return makeItem('npm', 'npm', 'error', null, tool.source, `执行失败：${tool.binPath}`, ba)
    return makeItem('npm', 'npm', 'ok', version, tool.source, undefined, ba)
  }
  return makeItem('npm', 'npm', 'missing', null, 'none', 'npm 随 Node.js 提供，启用内置 Node 即就绪', ba)
}

async function detectPnpm(workspaceDir: string): Promise<EnvItem> {
  const tool = resolveEnvTool(workspaceDir, 'pnpm')
  const ba = bundledToolPath('pnpm') !== null
  if (tool.source === 'bundled' || tool.source === 'portable' || tool.source === 'system') {
    const version = await runVersion(tool.binPath!, ['--version'], buildRuntimeEnv(workspaceDir))
    if (version === null) return makeItem('pnpm', 'pnpm', 'error', null, tool.source, `执行失败：${tool.binPath}`, ba)
    return makeItem('pnpm', 'pnpm', 'ok', version, tool.source, undefined, ba)
  }
  return makeItem('pnpm', 'pnpm', 'missing', null, 'none', '未安装（可一键安装，内置环境免下载）', ba)
}

async function detectGit(workspaceDir: string): Promise<EnvItem> {
  const tool = resolveEnvTool(workspaceDir, 'git')
  const ba = bundledToolPath('git') !== null
  if (tool.source === 'bundled' || tool.source === 'portable' || tool.source === 'system') {
    const version = await runVersion(tool.binPath!, ['--version'])
    if (version === null) return makeItem('git', 'Git', 'error', null, tool.source, `执行失败：${tool.binPath}`, ba)
    return makeItem('git', 'Git', 'ok', version, tool.source, undefined, ba)
  }
  return makeItem('git', 'Git', 'missing', null, 'none', '未检测到内置、便携版或系统 Git', ba)
}

function readDshVersion(pkgPath: string): string | null {
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as { version?: string }
    return pkg.version ?? null
  } catch {
    return null
  }
}

async function detectDsh(workspaceDir: string): Promise<EnvItem> {
  const tool = resolveEnvTool(workspaceDir, 'dsh')
  const ba = bundledToolPath('dsh') !== null
  if (tool.source === 'bundled') {
    const envDir = tool.bundledDir
    const manifest = readEnvManifest(envDir)
    const dshEntry = manifest?.dsh
    const relDir = dshEntry && typeof dshEntry !== 'string' && dshEntry.dir ? dshEntry.dir : 'dsh-cli'
    const pkgPath = envDir ? path.join(envDir, relDir, 'package.json') : null
    const version = pkgPath ? readDshVersion(pkgPath) : null
    if (version === null) return makeItem('dsh', 'DeepSeek Harness (dsh)', 'error', null, 'bundled', '内置 dsh 包缺少 version', ba)
    return makeItem('dsh', 'DeepSeek Harness (dsh)', 'ok', `v${version}`, 'bundled', undefined, ba)
  }
  if (tool.source === 'portable') {
    const pkgPath = path.join(workspaceDir, 'runtime', 'dsh', 'node_modules', '@deepseek-ai', 'dsh', 'package.json')
    const version = readDshVersion(pkgPath)
    if (version === null) return makeItem('dsh', 'DeepSeek Harness (dsh)', 'error', null, 'portable', 'package.json 缺少 version 字段', ba)
    return makeItem('dsh', 'DeepSeek Harness (dsh)', 'ok', `v${version}`, 'portable', undefined, ba)
  }
  return makeItem('dsh', 'DeepSeek Harness (dsh)', 'missing', null, 'none', '未安装（内置环境免下载一键启用）', ba)
}

export async function detectEnv(workspaceDir: string): Promise<EnvReport> {
  const items = await Promise.all([
    detectNode(workspaceDir),
    detectNpm(workspaceDir),
    detectPnpm(workspaceDir),
    detectGit(workspaceDir),
    detectDsh(workspaceDir)
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
