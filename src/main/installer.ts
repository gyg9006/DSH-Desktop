/**
 * 一键安装 / 一键更新（M2，P3 增强）：
 * - Node.js：优先使用打包内置便携环境（resources/portable-env，免下载）；否则从 nodejs.org/npmmirror 获取 LTS zip；
 * - npm：随便携 Node 提供，单独更新走 npm install -g npm@latest；
 * - pnpm：优先内置 tgz；否则经便携 Node 的 corepack 启用（失败降级 npm install -g pnpm）；
 * - Git：优先内置 MinGit zip；否则官方 GitHub Releases（不可达时降级 npmmirror 镜像）；
 * - dsh：优先内置 tgz；否则 npm install @deepseek-ai/dsh --prefix runtime/dsh。
 * 全部产物落在工作文件夹内；安装/更新前备份旧版本；支持取消与实时进度；内置包经 sha256 校验。
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { app } from 'electron'
import { runCommand } from './utils/process'
import { buildRuntimeEnv } from './envCheck'
import type { InstallKey, InstallMode } from '../shared/ipc'

/** 安装/更新类命令超时（规格 0.5：600s）。 */
export const INSTALL_TIMEOUT_MS = 600000
/** 检测类命令超时（规格 0.5：30s）。 */
export const DETECT_TIMEOUT_MS = 30000

export class InstallError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InstallError'
  }
}

export class InstallCancelledError extends Error {
  constructor() {
    super('安装已取消')
    this.name = 'InstallCancelledError'
  }
}

export interface InstallCallbacks {
  log: (message: string) => void
  progress: (percent: number | null, label?: string) => void
}

export const INSTALL_KEY_LABELS: Record<InstallKey, string> = {
  node: 'Node.js',
  npm: 'npm',
  pnpm: 'pnpm',
  git: 'Git',
  dsh: 'DeepSeek Harness (dsh)'
}

export const INSTALL_KEYS: InstallKey[] = ['node', 'npm', 'pnpm', 'git', 'dsh']

// ---------------------------------------------------------------------------
// 纯函数（可单测）
// ---------------------------------------------------------------------------

/** 从 nodejs.org/dist/index.json（按新到旧排序）选取最新 LTS 版本。 */
export function pickLatestLts(entries: Array<{ version?: unknown; lts?: unknown }>): string | null {
  for (const entry of entries) {
    const lts = entry.lts
    if (lts === false || lts === undefined || lts === null) continue
    if (typeof entry.version === 'string' && /^v\d+\.\d+\.\d+$/.test(entry.version)) {
      return entry.version
    }
  }
  return null
}

export function nodeZipUrl(version: string): string {
  return `https://nodejs.org/dist/${version}/node-${version}-win-x64.zip`
}

/** 解析 PortableGit 镜像版本目录名，如 "v2.51.1.windows.1/" → {2,51,1,1}。 */
export function parsePortableGitVersionDir(
  name: string
): { major: number; minor: number; patch: number; windows: number } | null {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:\.windows\.(\d+))?$/.exec(String(name ?? '').replace(/\/$/, ''))
  if (!m) return null
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]), windows: m[4] ? Number(m[4]) : 0 }
}

export function compareGitVersions(
  a: { major: number; minor: number; patch: number; windows: number },
  b: { major: number; minor: number; patch: number; windows: number }
): number {
  if (a.major !== b.major) return a.major - b.major
  if (a.minor !== b.minor) return a.minor - b.minor
  if (a.patch !== b.patch) return a.patch - b.patch
  return a.windows - b.windows
}

/** PortableGit 资产名（不同版本命名略有差异，统一按正则匹配 x64 的 7z 自解压包）。 */
export const PORTABLE_GIT_ASSET_RE = /^PortableGit-.*-64-bit\.7z\.exe$/

// ---------------------------------------------------------------------------
// 打包内置便携环境（P3）：resources/portable-env/ + env-manifest.json
// ---------------------------------------------------------------------------

export interface EnvManifest {
  [key: string]: { version?: string; archive?: string; sha256?: string } | undefined
}

/** 读取 env-manifest.json；缺失/损坏返回 null。 */
export function readEnvManifest(envDir: string): EnvManifest | null {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(envDir, 'env-manifest.json'), 'utf8')) as EnvManifest
    return raw && typeof raw === 'object' ? raw : null
  } catch {
    return null
  }
}

/** 计算文件 sha256（hex）。 */
export function sha256Of(file: string): string {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}

/** 校验文件 sha256；文件缺失或哈希不符返回 false。 */
export function verifySha256(file: string, expected: string | undefined): boolean {
  if (!expected || !fs.existsSync(file)) return false
  try {
    return sha256Of(file) === expected.toLowerCase()
  } catch {
    return false
  }
}

/** 从内置目录解析某组件的归档；未内置返回 null。 */
export function bundledArchive(envDir: string | null, key: InstallKey): { archivePath: string; version: string; sha256: string } | null {
  if (!envDir) return null
  const manifest = readEnvManifest(envDir)
  const entry = manifest?.[key]
  if (!entry?.archive || !entry.version) return null
  const archivePath = path.join(envDir, entry.archive)
  if (!fs.existsSync(archivePath)) return null
  return { archivePath, version: entry.version, sha256: entry.sha256 ?? '' }
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
    /* electron app 未就绪 */
  }
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, 'env-manifest.json'))) return dir
  }
  return null
}

/** 在当前内置环境中查找某组件的归档（便捷封装）。 */
function bundled(key: InstallKey): { archivePath: string; version: string; sha256: string } | null {
  return bundledArchive(portableEnvDir(), key)
}

// ---------------------------------------------------------------------------
// 内部工具
// ---------------------------------------------------------------------------

function throwIfCancelled(signal: AbortSignal): void {
  if (signal.aborted) throw new InstallCancelledError()
}

function cleanup(...paths: string[]): void {
  for (const p of paths) {
    try {
      fs.rmSync(p, { recursive: true, force: true })
    } catch {
      /* 忽略清理失败 */
    }
  }
}

/** 安装子进程环境：便携运行时 PATH + npm/corepack 缓存收敛到工作文件夹（见 envCheck.buildRuntimeEnv）。 */
function buildInstallEnv(workspaceDir: string): NodeJS.ProcessEnv {
  return buildRuntimeEnv(workspaceDir)
}

/** 下载文件（支持进度回调与取消；网络异常给出中文原因）。 */
async function downloadFile(
  url: string,
  destPath: string,
  cbs: InstallCallbacks,
  signal: AbortSignal
): Promise<void> {
  cbs.log(`下载：${url}`)
  let response: Response
  try {
    response = await fetch(url, { redirect: 'follow', signal })
  } catch (error) {
    if (signal.aborted) throw new InstallCancelledError()
    const reason = error instanceof Error ? error.message : String(error)
    throw new InstallError(`网络错误：${reason}。可能是网络不可达或超时（下载地址：${url}）`)
  }
  if (!response.ok || !response.body) {
    throw new InstallError(`下载失败：HTTP ${response.status}（${url}）。请检查网络后重试`)
  }
  const total = Number(response.headers.get('content-length') ?? 0)
  fs.mkdirSync(path.dirname(destPath), { recursive: true })
  const file = fs.createWriteStream(destPath)
  const reader = response.body.getReader()
  let received = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      received += value.byteLength
      file.write(Buffer.from(value.buffer, value.byteOffset, value.byteLength))
      if (total > 0) cbs.progress(Math.min(99, Math.round((received / total) * 100)), '下载中')
    }
  } catch (error) {
    file.destroy()
    if (signal.aborted) throw new InstallCancelledError()
    throw new InstallError(`下载中断：${error instanceof Error ? error.message : String(error)}`)
  }
  await new Promise<void>((resolve, reject) => {
    file.on('error', reject)
    file.end(() => resolve())
  })
  cbs.progress(100, '下载完成')
}

/** 用 Windows 自带 tar（bsdtar）解压 zip。 */
async function extractZip(zipPath: string, destDir: string, cbs: InstallCallbacks, signal: AbortSignal): Promise<void> {
  cbs.progress(null, '解压中')
  const result = await runCommand({
    command: 'tar',
    args: ['-xf', zipPath, '-C', destDir],
    timeoutMs: INSTALL_TIMEOUT_MS,
    signal
  })
  if (result.aborted) throw new InstallCancelledError()
  if (result.error) throw new InstallError(`解压失败：${result.error}`)
}

/** PortableGit 为 7-Zip 自解压包，带 -o 输出目录与 -y 覆盖参数执行。 */
async function extractGitSfx(sfxPath: string, destDir: string, cbs: InstallCallbacks, signal: AbortSignal): Promise<void> {
  cbs.progress(null, '自解压中（约需 1-2 分钟）')
  const result = await runCommand({
    command: sfxPath,
    args: [`-o${destDir}`, '-y'],
    timeoutMs: INSTALL_TIMEOUT_MS,
    signal
  })
  if (result.aborted) throw new InstallCancelledError()
  if (result.error) throw new InstallError(`Git 解压失败：${result.error}`)
}

/** 备份旧目录并把 staging 提升为新目录；失败时回滚。 */
function swapWithBackup(stagingDir: string, targetDir: string, bakDir: string, label: string): void {
  if (fs.existsSync(targetDir)) {
    if (fs.existsSync(bakDir)) fs.rmSync(bakDir, { recursive: true, force: true })
    fs.renameSync(targetDir, bakDir)
  }
  try {
    fs.renameSync(stagingDir, targetDir)
  } catch (error) {
    if (fs.existsSync(bakDir) && !fs.existsSync(targetDir)) fs.renameSync(bakDir, targetDir)
    throw new InstallError(`替换 ${label} 失败：${error instanceof Error ? error.message : String(error)}`)
  }
}

// ---------------------------------------------------------------------------
// 各项安装/更新
// ---------------------------------------------------------------------------

async function fetchLatestLtsVersion(cbs: InstallCallbacks, signal: AbortSignal): Promise<string> {
  cbs.log('查询 Node.js 最新 LTS 版本…')
  let json: unknown
  try {
    const res = await fetch('https://nodejs.org/dist/index.json', { signal })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    json = await res.json()
  } catch (error) {
    if (signal.aborted) throw new InstallCancelledError()
    const reason = error instanceof Error ? error.message : String(error)
    throw new InstallError(`获取 Node.js 版本列表失败：${reason}`)
  }
  const version = pickLatestLts(Array.isArray(json) ? json : [])
  if (!version) throw new InstallError('未能从 Node.js 版本列表解析出最新 LTS 版本')
  return version
}

async function installNode(
  workspaceDir: string,
  mode: InstallMode,
  cbs: InstallCallbacks,
  signal: AbortSignal
): Promise<void> {
  const nodeDir = path.join(workspaceDir, 'runtime', 'node')
  const downloadsDir = path.join(workspaceDir, 'runtime', '.downloads')
  const action = mode === 'update' ? '更新' : '安装'
  const bundledNode = bundled('node')

  let version: string
  let zipPath: string
  if (bundledNode) {
    version = bundledNode.version
    cbs.log(`使用内置便携环境：Node.js ${version}（免下载）`)
    zipPath = bundledNode.archivePath
    if (!verifySha256(zipPath, bundledNode.sha256)) {
      throw new InstallError('内置 Node.js 校验失败（sha256 不匹配），请重新打包或改用网络安装')
    }
  } else {
    version = await fetchLatestLtsVersion(cbs, signal)
    cbs.log(`开始${action} Node.js ${version}`)
    zipPath = path.join(downloadsDir, `node-${version}-win-x64.zip`)
    await downloadFile(nodeZipUrl(version), zipPath, cbs, signal)
    throwIfCancelled(signal)
  }

  const staging = path.join(workspaceDir, 'runtime', `.node-staging-${Date.now()}`)
  try {
    fs.mkdirSync(staging, { recursive: true })
    await extractZip(zipPath, staging, cbs, signal)
    throwIfCancelled(signal)

    const extractedDir = path.join(staging, `node-${version}-win-x64`)
    const nodeExe = path.join(extractedDir, 'node.exe')
    if (!fs.existsSync(nodeExe)) {
      throw new InstallError('解压后未找到 node.exe，安装包可能不完整或已损坏')
    }
    const check = await runCommand({ command: nodeExe, args: ['--version'], timeoutMs: DETECT_TIMEOUT_MS, signal })
    if (check.aborted) throw new InstallCancelledError()
    if (check.error) throw new InstallError(`node.exe 校验失败：${check.error}`)
    const verified = check.stdout.trim()
    cbs.log(`校验通过：${verified}`)

    swapWithBackup(extractedDir, nodeDir, path.join(workspaceDir, 'runtime', 'node.bak'), 'Node.js')
    cbs.log(`Node.js ${verified} ${action}完成（旧版本已备份至 runtime/node.bak）`)
  } finally {
    cleanup(staging)
    if (!bundledNode) cleanup(zipPath)
  }
}

/** 便携 Node 的 JS 入口执行器：node.exe <nodeDir>/<script> <args>（绕开 .cmd 的 shell 解析，最稳）。 */
function nodeScriptArgs(
  nodeDir: string,
  scriptRel: string,
  args: string[]
): { command: string; args: string[] } {
  return {
    command: path.join(nodeDir, 'node.exe'),
    args: [path.join(nodeDir, scriptRel), ...args]
  }
}

/** 便携 npm 的 npm-cli.js 入口。 */
function npmCliArgs(nodeDir: string, args: string[]): { command: string; args: string[] } {
  return nodeScriptArgs(nodeDir, path.join('node_modules', 'npm', 'bin', 'npm-cli.js'), args)
}

/** 便携 corepack 的 JS 入口。 */
function corepackJsArgs(nodeDir: string, args: string[]): { command: string; args: string[] } {
  return nodeScriptArgs(nodeDir, path.join('node_modules', 'corepack', 'dist', 'corepack.js'), args)
}

async function installNpm(
  workspaceDir: string,
  mode: InstallMode,
  cbs: InstallCallbacks,
  signal: AbortSignal
): Promise<void> {
  const nodeDir = path.join(workspaceDir, 'runtime', 'node')
  const nodeExe = path.join(nodeDir, 'node.exe')
  if (!fs.existsSync(nodeExe)) throw new InstallError('未找到便携 Node（请先安装 Node.js）')
  const action = mode === 'update' ? '更新' : '安装'
  cbs.log(`开始${action} npm（经便携 Node）…`)
  const { command, args } = npmCliArgs(nodeDir, ['install', '-g', 'npm@latest', '--no-audit', '--no-fund'])
  const result = await runCommand({
    command,
    args,
    cwd: nodeDir,
    env: buildInstallEnv(workspaceDir),
    timeoutMs: INSTALL_TIMEOUT_MS,
    signal,
    onStdout: (chunk) => cbs.log(chunk.trim())
  })
  if (result.aborted) throw new InstallCancelledError()
  if (result.error) throw new InstallError(`npm ${action}失败：${result.error}`)
  const ver = await runCommand({
    command: path.join(nodeDir, 'npm.cmd'),
    args: ['--version'],
    timeoutMs: DETECT_TIMEOUT_MS,
    env: buildInstallEnv(workspaceDir)
  })
  cbs.log(`npm ${ver.stdout.trim()} ${action}完成`)
}

async function installPnpm(
  workspaceDir: string,
  mode: InstallMode,
  cbs: InstallCallbacks,
  signal: AbortSignal
): Promise<void> {
  const nodeDir = path.join(workspaceDir, 'runtime', 'node')
  const nodeExe = path.join(nodeDir, 'node.exe')
  const corepackJs = path.join(nodeDir, 'node_modules', 'corepack', 'dist', 'corepack.js')
  const pnpmCmd = path.join(nodeDir, 'pnpm.cmd')
  const env = buildInstallEnv(workspaceDir)
  const action = mode === 'update' ? '更新' : '安装'
  cbs.log(`开始${action} pnpm…`)

  if (!fs.existsSync(nodeExe)) throw new InstallError('未找到便携 Node（请先安装 Node.js）')

  const bundledPnpm = bundled('pnpm')
  if (bundledPnpm) {
    // 内置 pnpm tgz：npm install -g <tgz>（免下载）
    cbs.log(`使用内置便携环境：pnpm ${bundledPnpm.version}（免下载）`)
    if (!verifySha256(bundledPnpm.archivePath, bundledPnpm.sha256)) {
      throw new InstallError('内置 pnpm 校验失败（sha256 不匹配），请重新打包或改用网络安装')
    }
    const { command, args } = npmCliArgs(nodeDir, ['install', '-g', bundledPnpm.archivePath, '--no-audit', '--no-fund'])
    const result = await runCommand({
      command,
      args,
      cwd: nodeDir,
      env,
      timeoutMs: INSTALL_TIMEOUT_MS,
      signal,
      onStdout: (chunk) => cbs.log(chunk.trim())
    })
    if (result.aborted) throw new InstallCancelledError()
    if (result.error) throw new InstallError(`pnpm ${action}失败：${result.error}`)
  } else if (!fs.existsSync(corepackJs)) {
    cbs.log('corepack 不可用，降级为 npm 全局安装 pnpm…')
    const { command, args } = npmCliArgs(nodeDir, [
      'install', '-g', 'pnpm' + (mode === 'update' ? '@latest' : ''), '--no-audit', '--no-fund'
    ])
    const result = await runCommand({
      command,
      args,
      cwd: nodeDir,
      env,
      timeoutMs: INSTALL_TIMEOUT_MS,
      signal,
      onStdout: (chunk) => cbs.log(chunk.trim())
    })
    if (result.aborted) throw new InstallCancelledError()
    if (result.error) throw new InstallError(`pnpm ${action}失败：${result.error}`)
  } else if (mode === 'update') {
    cbs.log('corepack 更新 pnpm@latest…')
    const { command, args } = corepackJsArgs(nodeDir, ['prepare', 'pnpm@latest', '--activate'])
    const prep = await runCommand({
      command,
      args,
      cwd: nodeDir,
      env,
      timeoutMs: INSTALL_TIMEOUT_MS,
      signal,
      onStdout: (chunk) => cbs.log(chunk.trim())
    })
    if (prep.aborted) throw new InstallCancelledError()
    if (prep.error) {
      cbs.log(`corepack 更新失败（${prep.error}），降级为 npm 全局更新…`)
      const fb = npmCliArgs(nodeDir, ['install', '-g', 'pnpm@latest', '--no-audit', '--no-fund'])
      const fallback = await runCommand({
        command: fb.command,
        args: fb.args,
        cwd: nodeDir,
        env,
        timeoutMs: INSTALL_TIMEOUT_MS,
        signal,
        onStdout: (chunk) => cbs.log(chunk.trim())
      })
      if (fallback.aborted) throw new InstallCancelledError()
      if (fallback.error) throw new InstallError(`pnpm 更新失败：${fallback.error}`)
    }
  } else {
    cbs.log('经 corepack 启用 pnpm（首次运行会自动下载 pnpm 包）…')
    const { command, args } = corepackJsArgs(nodeDir, ['enable', 'pnpm'])
    const enable = await runCommand({
      command,
      args,
      cwd: nodeDir,
      env,
      timeoutMs: INSTALL_TIMEOUT_MS,
      signal,
      onStdout: (chunk) => cbs.log(chunk.trim())
    })
    if (enable.aborted) throw new InstallCancelledError()
    if (enable.error) throw new InstallError(`corepack 启用 pnpm 失败：${enable.error}`)
  }

  const verify = await runCommand({
    command: pnpmCmd,
    args: ['--version'],
    cwd: nodeDir,
    env,
    timeoutMs: INSTALL_TIMEOUT_MS,
    signal,
    onStdout: (chunk) => cbs.log(chunk.trim())
  })
  if (verify.aborted) throw new InstallCancelledError()
  if (verify.error) throw new InstallError(`pnpm 校验失败：${verify.error}`)
  cbs.log(`pnpm ${verify.stdout.trim()} ${action}完成`)
}

/** 从 npmmirror 二进制镜像解析最新 PortableGit 的版本与下载地址。 */
async function fetchGitMirror(signal: AbortSignal): Promise<{ version: string; url: string }> {
  let names: unknown
  try {
    const listRes = await fetch('https://registry.npmmirror.com/-/binary/git-for-windows/', { signal })
    if (!listRes.ok) throw new Error(`HTTP ${listRes.status}`)
    names = await listRes.json()
  } catch (error) {
    if (signal.aborted) throw new InstallCancelledError()
    const reason = error instanceof Error ? error.message : String(error)
    throw new InstallError(`获取 Git 版本列表失败：${reason}`)
  }
  const versions = (Array.isArray(names) ? names : [])
    .map((n) => parsePortableGitVersionDir(typeof n === 'string' ? n : (n as { name?: string })?.name ?? ''))
    .filter((v): v is NonNullable<typeof v> => v !== null)
    .sort(compareGitVersions)
  const latest = versions[versions.length - 1]
  if (!latest) throw new InstallError('镜像中未找到可用的 Git 版本')
  const version = `${latest.major}.${latest.minor}.${latest.patch}${latest.windows > 0 ? `.windows.${latest.windows}` : ''}`
  const dirUrl = `https://registry.npmmirror.com/-/binary/git-for-windows/v${version}/`
  let files: unknown
  try {
    const dirRes = await fetch(dirUrl, { signal })
    if (!dirRes.ok) throw new Error(`HTTP ${dirRes.status}`)
    files = await dirRes.json()
  } catch (error) {
    if (signal.aborted) throw new InstallCancelledError()
    const reason = error instanceof Error ? error.message : String(error)
    throw new InstallError(`获取 Git 安装包列表失败：${reason}`)
  }
  const assetName = (Array.isArray(files) ? files : [])
    .map((f) => (typeof f === 'string' ? f : (f as { name?: string })?.name ?? ''))
    .find((n) => PORTABLE_GIT_ASSET_RE.test(n))
  if (!assetName) throw new InstallError('镜像中未找到 PortableGit 安装包')
  return { version, url: dirUrl + assetName }
}

async function fetchLatestGit(
  cbs: InstallCallbacks,
  signal: AbortSignal
): Promise<{ version: string; urls: string[] }> {
  // 官方 GitHub Releases 优先（普通用户网络一般可达），npmmirror 镜像始终作为下载备用源
  const mirror = await fetchGitMirror(signal)
  try {
    const res = await fetch('https://api.github.com/repos/git-for-windows/git/releases/latest', {
      signal,
      headers: { 'User-Agent': 'dsh-workbench', Accept: 'application/vnd.github+json' }
    })
    if (res.ok) {
      const data = (await res.json()) as {
        tag_name?: unknown
        assets?: Array<{ name?: unknown; browser_download_url?: unknown }>
      }
      const tag = typeof data.tag_name === 'string' ? data.tag_name.replace(/^v/, '') : ''
      const asset = (data.assets ?? []).find(
        (a) => typeof a.name === 'string' && PORTABLE_GIT_ASSET_RE.test(a.name)
      )
      if (tag && typeof asset?.browser_download_url === 'string') {
        cbs.log(`Git 最新版：${tag}（官方源；下载失败将自动切换镜像备用源）`)
        return { version: tag, urls: [asset.browser_download_url, mirror.url] }
      }
    }
  } catch {
    /* 官方源不可达，仅使用镜像 */
  }
  cbs.log(`Git 最新版：${mirror.version}（镜像源）`)
  return { version: mirror.version, urls: [mirror.url] }
}

async function installGit(
  workspaceDir: string,
  mode: InstallMode,
  cbs: InstallCallbacks,
  signal: AbortSignal
): Promise<void> {
  const gitDir = path.join(workspaceDir, 'runtime', 'git')
  const downloadsDir = path.join(workspaceDir, 'runtime', '.downloads')
  const action = mode === 'update' ? '更新' : '安装'
  const bundledGit = bundled('git')

  let version: string
  let staging = path.join(workspaceDir, 'runtime', `.git-staging-${Date.now()}`)
  let sfxPath: string | null = null
  try {
    if (bundledGit) {
      // 内置 MinGit zip：免下载 + sha256 校验 + tar 解压
      version = bundledGit.version
      cbs.log(`使用内置便携环境：Git ${version}（免下载）`)
      if (!verifySha256(bundledGit.archivePath, bundledGit.sha256)) {
        throw new InstallError('内置 Git 校验失败（sha256 不匹配），请重新打包或改用网络安装')
      }
      fs.mkdirSync(staging, { recursive: true })
      await extractZip(bundledGit.archivePath, staging, cbs, signal)
      throwIfCancelled(signal)
    } else {
      const fetched = await fetchLatestGit(cbs, signal)
      version = fetched.version
      cbs.log(`开始${action} Portable Git ${version}`)
      sfxPath = path.join(downloadsDir, `PortableGit-${version}-64-bit.7z.exe`)
      // 依次尝试各下载源（官方 → 镜像），全部失败才报错
      let downloaded = false
      let lastError: string | null = null
      for (const url of fetched.urls) {
        if (signal.aborted) throw new InstallCancelledError()
        try {
          await downloadFile(url, sfxPath, cbs, signal)
          downloaded = true
          break
        } catch (error) {
          if (error instanceof InstallCancelledError || signal.aborted) throw error
          lastError = error instanceof Error ? error.message : String(error)
          cbs.log(`该源下载失败，尝试备用源…（${lastError}）`)
        }
      }
      if (!downloaded) throw new InstallError(`PortableGit 下载失败：${lastError ?? '未知原因'}`)
      throwIfCancelled(signal)

      fs.mkdirSync(staging, { recursive: true })
      await extractGitSfx(sfxPath, staging, cbs, signal)
      throwIfCancelled(signal)
    }

    // 定位 git.exe 所在根目录（内置 MinGit 带一层版本前缀目录；sfx 直接是根）
    const gitRoot = findGitRoot(staging)
    if (!gitRoot) {
      throw new InstallError('解压后未找到 cmd/git.exe，安装包可能不完整或已损坏')
    }
    const gitExe = path.join(gitRoot, 'cmd', 'git.exe')
    const check = await runCommand({ command: gitExe, args: ['--version'], timeoutMs: DETECT_TIMEOUT_MS, signal })
    if (check.aborted) throw new InstallCancelledError()
    if (check.error) throw new InstallError(`git.exe 校验失败：${check.error}`)
    cbs.log(`校验通过：${check.stdout.trim()}`)

    swapWithBackup(gitRoot, gitDir, path.join(workspaceDir, 'runtime', 'git.bak'), 'Git')
    cbs.log(`Git ${check.stdout.trim()} ${action}完成（旧版本已备份至 runtime/git.bak）`)
  } finally {
    cleanup(staging)
    if (!bundledGit && sfxPath) cleanup(sfxPath)
  }
}

/** 在解压目录中定位包含 cmd/git.exe 的 git 根目录（MinGit zip 带一层版本前缀目录）。 */
export function findGitRoot(staging: string): string | null {
  if (fs.existsSync(path.join(staging, 'cmd', 'git.exe'))) return staging
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(staging, { withFileTypes: true })
  } catch {
    return null
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const candidate = path.join(staging, entry.name)
    if (fs.existsSync(path.join(candidate, 'cmd', 'git.exe'))) return candidate
  }
  return null
}

async function installDsh(
  workspaceDir: string,
  mode: InstallMode,
  cbs: InstallCallbacks,
  signal: AbortSignal
): Promise<void> {
  const nodeDir = path.join(workspaceDir, 'runtime', 'node')
  const nodeExe = path.join(nodeDir, 'node.exe')
  const dshDir = path.join(workspaceDir, 'runtime', 'dsh')
  if (!fs.existsSync(nodeExe)) throw new InstallError('未找到便携 Node（请先安装 Node.js）')
  const action = mode === 'update' ? '更新' : '安装'

  const bundledDsh = bundled('dsh')
  let pkg: string
  if (bundledDsh) {
    cbs.log(`使用内置便携环境：dsh ${bundledDsh.version}（免下载）`)
    if (!verifySha256(bundledDsh.archivePath, bundledDsh.sha256)) {
      throw new InstallError('内置 dsh 校验失败（sha256 不匹配），请重新打包或改用网络安装')
    }
    pkg = bundledDsh.archivePath
  } else {
    pkg = '@deepseek-ai/dsh' + (mode === 'update' ? '@latest' : '')
    cbs.log(`开始${action} DeepSeek Harness（npm install ${pkg}）…`)
  }

  fs.mkdirSync(dshDir, { recursive: true })
  const { command, args } = npmCliArgs(nodeDir, ['install', pkg, '--prefix', dshDir, '--no-audit', '--no-fund'])
  const result = await runCommand({
    command,
    args,
    cwd: dshDir,
    env: buildInstallEnv(workspaceDir),
    timeoutMs: INSTALL_TIMEOUT_MS,
    signal,
    onStdout: (chunk) => cbs.log(chunk.trim())
  })
  if (result.aborted) throw new InstallCancelledError()
  if (result.error) throw new InstallError(`dsh ${action}失败：${result.error}`)

  let version: string | null = null
  try {
    const pkgPath = path.join(dshDir, 'node_modules', '@deepseek-ai', 'dsh', 'package.json')
    version = (JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as { version?: string }).version ?? null
  } catch {
    /* 版本读取失败不阻塞 */
  }
  cbs.log(`DeepSeek Harness v${version ?? '?'} ${action}完成`)
}

// ---------------------------------------------------------------------------
// 任务调度（一次仅一个任务，支持取消）
// ---------------------------------------------------------------------------

const installers: Record<InstallKey, (ws: string, mode: InstallMode, cbs: InstallCallbacks, signal: AbortSignal) => Promise<void>> = {
  node: installNode,
  npm: installNpm,
  pnpm: installPnpm,
  git: installGit,
  dsh: installDsh
}

let currentController: AbortController | null = null

export function cancelInstall(): void {
  currentController?.abort()
}

export function hasRunningInstall(): boolean {
  return currentController !== null
}

export async function runInstall(
  workspaceDir: string,
  key: InstallKey,
  mode: InstallMode,
  cbs: InstallCallbacks
): Promise<{ ok: boolean; error?: string; cancelled?: boolean }> {
  if (currentController) return { ok: false, error: '已有安装任务进行中，请先完成或取消' }
  const controller = new AbortController()
  currentController = controller
  try {
    cbs.log(`任务开始：${INSTALL_KEY_LABELS[key]}（${mode === 'update' ? '更新' : '安装'}）`)
    await installers[key](workspaceDir, mode, cbs, controller.signal)
    return { ok: true }
  } catch (error) {
    if (error instanceof InstallCancelledError || controller.signal.aborted) {
      return { ok: false, cancelled: true }
    }
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  } finally {
    currentController = null
  }
}
