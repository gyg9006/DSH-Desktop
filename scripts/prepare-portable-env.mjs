/**
 * 打包内置便携环境（P3，2026-08 修复版）：
 * 下载 Node / MinGit / pnpm / dsh 的便携包到 resources/portable-env/，
 * 解压为「可执行目录」形态（不是原始归档），并生成 env-manifest.json。
 *
 * 产物结构（运行时可直接执行 / 直接复制到工作区）：
 *   resources/portable-env/
 *   ├── node/          # Node 便携版根（含 node.exe / bin/node，随平台）
 *   ├── git/           # Git 便携版根（含 cmd/git.exe；macOS/Linux 未内置时为系统依赖）
 *   ├── pnpm/          # pnpm 独立二进制（pnpm.exe / pnpm）
 *   ├── dsh-cli/       # DSH Harness CLI（npm 包解压目录，含 package.json bin）
 *   └── env-manifest.json   # 版本清单（platform/arch + 各组件 dir/version/sha256）
 *
 * 用法：
 *   node scripts/prepare-portable-env.mjs                 # 当前平台全部默认（最新 LTS 等）
 *   node scripts/prepare-portable-env.mjs --node v24.19.0 # 指定 Node 版本
 *   node scripts/prepare-portable-env.mjs --git 2.55.0.windows.1
 *   node scripts/prepare-portable-env.mjs --pnpm 9.15.0 --dsh 0.1.0-rc.5
 *   node scripts/prepare-portable-env.mjs --skip node,git # 跳过某些组件
 *   node scripts/prepare-portable-env.mjs --force         # 忽略已有缓存强制重下
 *
 * 说明：下载优先 npmmirror（国内可达）；npm pack 经 node 直接执行 npm-cli.js（绕开 .cmd）。
 * 三端：win32→node.exe/cmd/git.exe/pnpm.exe；darwin→bin/node/pnpm(Mach-O)；
 *       linux→bin/node/pnpm(ELF)。Git 仅 Windows 内置（MinGit），mac/linux 标记为系统依赖。
 */
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outDir = path.join(projectRoot, 'resources', 'portable-env')
const MIRROR = 'https://npmmirror.com/mirrors'
const REGISTRY = 'https://registry.npmmirror.com'
const platform = process.platform // win32 | darwin | linux
const arch = process.arch // x64 | arm64 ...

function arg(name) {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : undefined
}
const skip = new Set((arg('--skip') ?? '').split(',').map((s) => s.trim()).filter(Boolean))
const force = process.argv.includes('--force')

const sha256Of = (file) => createHash('sha256').update(fs.readFileSync(file)).digest('hex')
const step = (msg) => console.log(`\n[prepare:env] ${msg}`)

/** 平台对应的 node 包名后缀（目录内可执行文件名）。 */
function nodePlatform() {
  if (platform === 'win32') return { suffix: `win-${arch}`, exe: 'node.exe' }
  if (platform === 'darwin') return { suffix: `darwin-${arch}`, exe: path.join('bin', 'node') }
  return { suffix: `linux-${arch}`, exe: path.join('bin', 'node') }
}

async function download(url, dest, label) {
  console.log(`  下载 ${label}：${url}`)
  const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(900000) })
  if (!res.ok || !res.body) throw new Error(`${label} 下载失败：HTTP ${res.status}（${url}）`)
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  const buf = Buffer.from(await res.arrayBuffer())
  fs.writeFileSync(dest, buf)
  console.log(`    → ${dest}（${(buf.length / 1024 / 1024).toFixed(1)} MB）`)
}

async function fetchJson(url, label) {
  const res = await fetch(url, { signal: AbortSignal.timeout(60000) })
  if (!res.ok) throw new Error(`${label} 获取失败：HTTP ${res.status}`)
  return res.json()
}

/** node 直执行 npm-cli.js（绕开 .cmd，沙箱/打包均可用）。 */
function npmPack(pkgSpec, destDir) {
  const nodeDir = path.dirname(process.execPath)
  const npmCli = path.join(nodeDir, 'node_modules', 'npm', 'bin', 'npm-cli.js')
  const r = spawnSync(
    process.execPath,
    [npmCli, 'pack', pkgSpec, '--pack-destination', destDir, '--registry', REGISTRY, '--no-audit', '--no-fund'],
    { encoding: 'utf8' }
  )
  if (r.status !== 0) throw new Error(`npm pack ${pkgSpec} 失败：${r.stderr || r.stdout}`)
  return r.stdout.trim().split('\n').filter(Boolean).pop()
}

/** 用系统 tar（bsdtar）解压 zip/tgz/tar.xz。 */
function extract(archive, destDir) {
  fs.mkdirSync(destDir, { recursive: true })
  const r = spawnSync('tar', ['-xf', archive, '-C', destDir], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  if (r.status !== 0) throw new Error(`解压 ${archive} 失败：${r.stderr || r.stdout}`)
}

/** 目录内单层版本前缀目录提升：MinGit zip 带 <MinGit-xxx>/ 一层前缀，解压后提升到根。 */
function liftSingleRoot(dir) {
  const entries = fs.readdirSync(dir)
  if (entries.length === 1) {
    const only = path.join(dir, entries[0])
    if (fs.statSync(only).isDirectory()) {
      const tmp = path.join(path.dirname(dir), `.lift-${Date.now()}`)
      fs.renameSync(only, tmp)
      for (const e of fs.readdirSync(dir)) fs.rmSync(path.join(dir, e), { recursive: true, force: true })
      for (const e of fs.readdirSync(tmp)) fs.renameSync(path.join(tmp, e), path.join(dir, e))
      fs.rmdirSync(tmp)
    }
  }
}

/** 校验文件存在且（对 exe/bin）可执行，返回版本输出。 */
function verifyExec(execPath, args, label) {
  if (!fs.existsSync(execPath)) throw new Error(`内置校验失败：${label} 不存在（${execPath}）`)
  if (platform === 'win32' && !/\.exe$/i.test(execPath)) throw new Error(`内置校验失败：${label} 不是 exe（${execPath}）`)
  const r = spawnSync(execPath, args, { encoding: 'utf8', timeout: 60000 })
  if (r.status !== 0) throw new Error(`内置校验失败：${label} 执行异常（${r.stderr || r.stdout}）`)
  return r.stdout.trim().split('\n')[0]
}

async function resolveNodeVersion(pin) {
  if (pin) return pin.startsWith('v') ? pin : `v${pin}`
  const list = await fetchJson(`${MIRROR}/node/index.json`, 'Node.js 版本列表')
  const lts = list.filter((e) => e.lts !== false && /^v\d+\.\d+\.\d+$/.test(e.version))[0]
  if (!lts) throw new Error('未找到 Node LTS 版本')
  return lts.version
}

async function resolveGitVersion(pin) {
  if (pin) return `v${pin.startsWith('v') ? pin.slice(1) : pin}`
  const names = await fetchJson(`${REGISTRY}/-/binary/git-for-windows/`, 'Git 版本列表')
  const vers = names
    .map((n) => /^v?(\d+)\.(\d+)\.(\d+)(?:\.windows\.(\d+))?\/?$/.exec(String(n.name ?? n ?? '').replace(/\/$/, '')))
    .filter(Boolean)
    .sort((a, b) => b[1] - a[1] || b[2] - a[2] || b[3] - a[3] || (b[4] ?? 0) - (a[4] ?? 0))
  if (!vers[0]) throw new Error('未找到 Git 版本')
  const [m1, m2, m3, m4] = vers[0].slice(1)
  return `v${m1}.${m2}.${m3}${m4 ? `.windows.${m4}` : ''}`
}

async function resolvePnpmVersion(pin) {
  if (pin) return pin
  const info = await fetchJson(`${REGISTRY}/pnpm/latest`, 'pnpm 版本')
  return String(info.version)
}

/** github.com 直连 IP 轮换（DNS 污染/限速绕行；git push 同款方案）。 */
const GITHUB_IPS = ['140.82.112.3', '140.82.114.3', '140.82.116.3', '20.205.243.166']
/** GitHub 资产下载加速镜像（直连不可达/限速时的备选）。 */
const GITHUB_MIRRORS = ['https://gh.ddlc.top/', 'https://gh-proxy.com/']

/** 下载 pnpm 平台归档（win: zip；mac/linux: tar.gz）并解压到 pnpm/ 目录。 */
async function downloadPnpmArchive(version, destDir) {
  const asset = {
    win32: `pnpm-win32-${arch === 'arm64' ? 'arm64' : 'x64'}.zip`,
    darwin: `pnpm-darwin-${arch === 'arm64' ? 'arm64' : 'x64'}.tar.gz`,
    linux: `pnpm-linux-${arch === 'arm64' ? 'arm64' : 'x64'}.tar.gz`
  }[platform]
  const url = `https://github.com/pnpm/pnpm/releases/download/v${version}/${asset}`
  console.log(`  下载 pnpm ${version}（${asset}）：${url}`)
  fs.mkdirSync(destDir, { recursive: true })
  const tmpFile = path.join(destDir, asset)
  const curl = platform === 'win32' ? 'curl.exe' : 'curl'
  let ok = false
  // 1) github.com 直连：多 IP 轮换 + 长超时（Actions 上直连秒下）
  for (let a = 1; a <= 8 && !ok; a++) {
    const ip = GITHUB_IPS[(a - 1) % GITHUB_IPS.length]
    if (fs.existsSync(tmpFile)) fs.rmSync(tmpFile, { force: true })
    const r = spawnSync(curl, ['-L', '-sS', '--fail', '--connect-timeout', '20', '--max-time', '600', '--resolve', `github.com:443:${ip}`, '-o', tmpFile, url], { encoding: 'utf8', timeout: 630000 })
    if (r.status === 0 && fs.existsSync(tmpFile) && fs.statSync(tmpFile).size > 100000) {
      ok = true
      break
    }
    console.log(`    github 直连尝试 ${a}（${ip}）失败/中断，重试…`)
  }
  // 2) 加速镜像备选（直连限速/不可达时）
  for (const mirror of GITHUB_MIRRORS) {
    if (ok) break
    if (fs.existsSync(tmpFile)) fs.rmSync(tmpFile, { force: true })
    console.log(`    尝试加速镜像：${mirror}`)
    const r = spawnSync(curl, ['-L', '-sS', '--fail', '--connect-timeout', '15', '--max-time', '900', '-o', tmpFile, mirror + url], { encoding: 'utf8', timeout: 930000 })
    if (r.status === 0 && fs.existsSync(tmpFile) && fs.statSync(tmpFile).size > 100000) {
      ok = true
      break
    }
    console.log(`    镜像 ${mirror} 失败，尝试下一个…`)
  }
  if (!ok) throw new Error(`pnpm 下载失败：${url}（github 直连与加速镜像均不可达）`)
  console.log(`    → ${tmpFile}（${(fs.statSync(tmpFile).size / 1024 / 1024).toFixed(1)} MB）`)
  extract(tmpFile, destDir)
  liftSingleRoot(destDir)
  fs.rmSync(tmpFile, { force: true })
  if (platform !== 'win32') {
    const p = path.join(destDir, 'pnpm')
    if (fs.existsSync(p)) fs.chmodSync(p, 0o755)
  }
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------
fs.mkdirSync(outDir, { recursive: true })
const manifest = { platform, arch }
console.log(`[prepare:env] 平台：${platform}/${arch} → ${outDir}`)

// ---- Node.js ----
if (!skip.has('node')) {
  step('Node.js')
  const ver = await resolveNodeVersion(arg('--node'))
  const np = nodePlatform()
  const zipName = `node-${ver}-${np.suffix}.${platform === 'win32' ? 'zip' : platform === 'darwin' ? 'tar.gz' : 'tar.xz'}`
  const archive = path.join(outDir, zipName)
  const nodeDir = path.join(outDir, 'node')
  const nodeExec = path.join(nodeDir, np.exe)
  if (force || !fs.existsSync(nodeExec)) {
    if (force || !fs.existsSync(archive)) {
      await download(`${MIRROR}/node/${ver}/${zipName}`, archive, `Node.js ${ver}`)
    } else {
      console.log(`  已存在，跳过下载：${zipName}`)
    }
    if (fs.existsSync(nodeDir)) fs.rmSync(nodeDir, { recursive: true, force: true })
    step(`  解压 Node.js ${ver} → node/`)
    extract(archive, nodeDir)
    liftSingleRoot(nodeDir)
  } else {
    console.log(`  解压目录已就绪，跳过（${nodeExec}）`)
  }
  const verOut = verifyExec(nodeExec, ['--version'], `Node.js ${ver}`)
  console.log(`  校验通过：${verOut}`)
  manifest.node = { version: ver, dir: 'node', exe: np.exe, archive: zipName, ...(fs.existsSync(archive) ? { sha256: sha256Of(archive) } : {}) }
  if (!force) fs.rmSync(archive, { force: true })
}

// ---- Git（仅 Windows 内置 MinGit；mac/linux 走系统依赖） ----
if (platform === 'win32' && !skip.has('git')) {
  step('Git (MinGit)')
  const dirVer = await resolveGitVersion(arg('--git'))
  const dirUrl = `${REGISTRY}/-/binary/git-for-windows/${dirVer}/`
  const files = await fetchJson(dirUrl, 'MinGit 资产列表')
  const assetName = (Array.isArray(files) ? files : []).map((f) => String(f.name ?? f ?? '')).find((n) => /^MinGit-.*-64-bit\.zip$/.test(n))
  if (!assetName) throw new Error(`未找到 ${dirVer} 的 MinGit-64-bit.zip`)
  const archive = path.join(outDir, assetName)
  const gitDir = path.join(outDir, 'git')
  const gitExec = path.join(gitDir, 'cmd', 'git.exe')
  if (force || !fs.existsSync(gitExec)) {
    if (force || !fs.existsSync(archive)) {
      await download(dirUrl + assetName, archive, `MinGit ${dirVer}`)
    } else {
      console.log(`  已存在，跳过下载：${assetName}`)
    }
    if (fs.existsSync(gitDir)) fs.rmSync(gitDir, { recursive: true, force: true })
    step(`  解压 MinGit ${dirVer} → git/`)
    extract(archive, gitDir)
    liftSingleRoot(gitDir)
  } else {
    console.log(`  解压目录已就绪，跳过（${gitExec}）`)
  }
  const verOut = verifyExec(gitExec, ['--version'], `Git ${dirVer}`)
  console.log(`  校验通过：${verOut}`)
  manifest.git = { version: dirVer.replace(/^v/, ''), dir: 'git', exe: path.join('cmd', 'git.exe'), archive: assetName, ...(fs.existsSync(archive) ? { sha256: sha256Of(archive) } : {}) }
  if (!force) fs.rmSync(archive, { force: true })
} else if (platform !== 'win32') {
  console.log('  （macOS/Linux 未内置 Git，检测时使用系统 Git）')
  manifest.git = { version: 'system', dir: null, exe: null }
}

// ---- pnpm（独立二进制） ----
if (!skip.has('pnpm')) {
  step('pnpm')
  const ver = await resolvePnpmVersion(arg('--pnpm'))
  const pnpmDir = path.join(outDir, 'pnpm')
  const exeName = platform === 'win32' ? 'pnpm.exe' : 'pnpm'
  const exePath = path.join(pnpmDir, exeName)
  if (force || !fs.existsSync(exePath)) {
    if (fs.existsSync(pnpmDir)) fs.rmSync(pnpmDir, { recursive: true, force: true })
    await downloadPnpmArchive(ver, pnpmDir)
  } else {
    console.log(`  已存在，跳过下载：pnpm ${ver}`)
  }
  const verOut = verifyExec(exePath, ['--version'], `pnpm ${ver}`)
  console.log(`  校验通过：${verOut}`)
  manifest.pnpm = { version: ver, dir: 'pnpm', exe: exeName, sha256: sha256Of(exePath) }
}

// ---- dsh（npm 包解压目录） ----
if (!skip.has('dsh')) {
  step('DeepSeek Harness (dsh)')
  const dshDir = path.join(outDir, 'dsh-cli')
  const pkgPath = path.join(dshDir, 'package.json')
  let dshSha256 = null
  if (force || !fs.existsSync(pkgPath)) {
    const spec = arg('--dsh') ? `@deepseek-ai/dsh@${arg('--dsh')}` : '@deepseek-ai/dsh@latest'
    const tmp = path.join(os.tmpdir(), `dshw-dsh-${Date.now()}`)
    fs.mkdirSync(tmp, { recursive: true })
    const tgzName = npmPack(spec, tmp)
    const tgzPath = path.join(tmp, tgzName)
    dshSha256 = sha256Of(tgzPath)
    if (fs.existsSync(dshDir)) fs.rmSync(dshDir, { recursive: true, force: true })
    step(`  解压 dsh → dsh-cli/`)
    extract(tgzPath, dshDir)
    liftSingleRoot(dshDir)
    fs.rmSync(tmp, { recursive: true, force: true })
  } else {
    console.log(`  解压目录已就绪，跳过（${pkgPath}）`)
  }
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
  if (!pkg.version) throw new Error('dsh package.json 缺少 version')
  const bin = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin?.dsh
  if (!bin) throw new Error('dsh package.json 缺少 bin.dsh')
  const binPath = path.join(dshDir, bin)
  if (!fs.existsSync(binPath)) throw new Error(`dsh bin 不存在：${binPath}`)
  console.log(`  校验通过：dsh v${pkg.version}（bin: ${bin}）`)
  manifest.dsh = { version: pkg.version, dir: 'dsh-cli', bin, ...(dshSha256 ? { sha256: dshSha256 } : {}) }
}

const manifestPath = path.join(outDir, 'env-manifest.json')
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n')
console.log('')
console.log('env-manifest.json 已生成：')
console.log(fs.readFileSync(manifestPath, 'utf8'))
console.log(`内置便携环境目录：${outDir}`)
