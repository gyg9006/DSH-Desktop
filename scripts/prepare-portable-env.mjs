/**
 * 打包内置便携环境（P3）：下载 Node / MinGit / pnpm / dsh 的便携归档到
 * resources/portable-env/，并生成 env-manifest.json（版本 + sha256）。
 *
 * 用法：
 *   node scripts/prepare-portable-env.mjs                 # 全部默认（最新 LTS 等）
 *   node scripts/prepare-portable-env.mjs --node v22.11.0 # 指定 Node 版本
 *   node scripts/prepare-portable-env.mjs --git 2.51.1.windows.1
 *   node scripts/prepare-portable-env.mjs --pnpm 9.15.0 --dsh 0.1.0-rc.5
 *   node scripts/prepare-portable-env.mjs --skip node,git # 跳过某些组件
 *
 * 说明：产物 = 原始归档（zip/tgz），运行时装到 workspace/runtime/<key>。
 * 下载优先 npmmirror（国内可达）；npm pack 经 node 直接执行 npm-cli.js（绕开 .cmd）。
 */
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outDir = path.join(projectRoot, 'resources', 'portable-env')
const MIRROR = 'https://npmmirror.com/mirrors'

function arg(name) {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : undefined
}
const skip = new Set((arg('--skip') ?? '').split(',').map((s) => s.trim()).filter(Boolean))

const sha256 = (file) => createHash('sha256').update(fs.readFileSync(file)).digest('hex')

async function download(url, dest, label) {
  console.log(`下载 ${label}：${url}`)
  const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(600000) })
  if (!res.ok || !res.body) throw new Error(`${label} 下载失败：HTTP ${res.status}`)
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  const buf = Buffer.from(await res.arrayBuffer())
  fs.writeFileSync(dest, buf)
  console.log(`  → ${dest}（${(buf.length / 1024 / 1024).toFixed(1)} MB）`)
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
  const r = spawnSync(process.execPath, [npmCli, 'pack', pkgSpec, '--pack-destination', destDir, '--registry', 'https://registry.npmmirror.com', '--no-audit', '--no-fund'], { encoding: 'utf8' })
  if (r.status !== 0) throw new Error(`npm pack ${pkgSpec} 失败：${r.stderr || r.stdout}`)
  const name = r.stdout.trim().split('\n').filter(Boolean).pop()
  return name
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
  const names = await fetchJson('https://registry.npmmirror.com/-/binary/git-for-windows/', 'Git 版本列表')
  const vers = names
    .map((n) => /^v?(\d+)\.(\d+)\.(\d+)(?:\.windows\.(\d+))?\/?$/.exec(String(n.name ?? n ?? '').replace(/\/$/, '')))
    .filter(Boolean)
    .sort((a, b) => b[1] - a[1] || b[2] - a[2] || b[3] - a[3] || (b[4] ?? 0) - (a[4] ?? 0))
  if (!vers[0]) throw new Error('未找到 Git 版本')
  const [m1, m2, m3, m4] = vers[0].slice(1)
  return `v${m1}.${m2}.${m3}${m4 ? `.windows.${m4}` : ''}`
}

fs.mkdirSync(outDir, { recursive: true })
const manifest = {}

// ---- Node.js ----
if (!skip.has('node')) {
  const ver = await resolveNodeVersion(arg('--node'))
  const zipName = `node-${ver}-win-x64.zip`
  const dest = path.join(outDir, zipName)
  if (!fs.existsSync(dest)) {
    await download(`${MIRROR}/node/${ver}/${zipName}`, dest, `Node.js ${ver}`)
  } else {
    console.log(`Node.js ${ver} 已存在，跳过下载`)
  }
  manifest.node = { version: ver, archive: zipName, sha256: sha256(dest) }
}

// ---- Git (MinGit zip) ----
if (!skip.has('git')) {
  const dirVer = await resolveGitVersion(arg('--git'))
  const dirUrl = `https://registry.npmmirror.com/-/binary/git-for-windows/${dirVer}/`
  const files = await fetchJson(dirUrl, 'MinGit 资产列表')
  const assetName = (Array.isArray(files) ? files : []).map((f) => String(f.name ?? f ?? '')).find((n) => /^MinGit-.*-64-bit\.zip$/.test(n))
  if (!assetName) throw new Error(`未找到 ${dirVer} 的 MinGit-64-bit.zip`)
  const dest = path.join(outDir, assetName)
  if (!fs.existsSync(dest)) {
    await download(dirUrl + assetName, dest, `MinGit ${dirVer}`)
  } else {
    console.log(`MinGit ${dirVer} 已存在，跳过下载`)
  }
  manifest.git = { version: dirVer.replace(/^v/, ''), archive: assetName, sha256: sha256(dest) }
}

// ---- pnpm（npm pack tgz） ----
if (!skip.has('pnpm')) {
  const spec = arg('--pnpm') ? `pnpm@${arg('--pnpm')}` : 'pnpm@latest'
  const name = npmPack(spec, outDir)
  const dest = path.join(outDir, name)
  const version = name.replace(/^pnpm-/, '').replace(/\.tgz$/, '')
  manifest.pnpm = { version, archive: name, sha256: sha256(dest) }
}

// ---- dsh（npm pack tgz） ----
if (!skip.has('dsh')) {
  const spec = arg('--dsh') ? `@deepseek-ai/dsh@${arg('--dsh')}` : '@deepseek-ai/dsh@latest'
  const name = npmPack(spec, outDir)
  const dest = path.join(outDir, name)
  // scoped 包 pack 名为 deepseek-ai-dsh-<ver>.tgz，版本号取 <ver>
  const version = name.replace(/\.tgz$/, '').replace(/^.*?(\d+\.\d+\.\d+.*)$/, '$1')
  manifest.dsh = { version, archive: name, sha256: sha256(dest) }
}

const manifestPath = path.join(outDir, 'env-manifest.json')
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n')
console.log('')
console.log('env-manifest.json 已生成：')
console.log(fs.readFileSync(manifestPath, 'utf8'))
console.log(`内置便携环境目录：${outDir}`)
