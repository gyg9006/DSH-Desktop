/**
 * 发布脚本：把交付目录的 app/ 打包为更新 zip（供 GitHub Releases 分发）。
 *
 * 用法：
 *   node scripts/release.mjs            # 打包 app/ → ../DSH-Desktop/DSH-Desktop-vX.Y.Z-win.zip
 *   node scripts/release.mjs --dry-run  # 只打印将包含的文件清单
 *
 * 产物结构：zip 根 = app 目录内容（客户端 updater 解压后直接替换 app/）。
 * 命名：DSH-Desktop-v<version>-win.zip（客户端 pickUpdateAsset 按 DSH-Desktop + .zip 匹配）。
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const deliverRoot = path.join(projectRoot, '..', 'DSH-Desktop')
const appDir = path.join(deliverRoot, 'app')
const dryRun = process.argv.includes('--dry-run')

const pkg = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'))
const version = pkg.version
const zipName = `DSH-Desktop-v${version}-win.zip`
const zipPath = path.join(deliverRoot, zipName)

if (!fs.existsSync(appDir)) {
  console.error(`未找到 ${appDir}，请先构建（npm run pack:dir）`)
  process.exit(1)
}

// 列出将打包的内容（排除临时/日志类文件）
function listFiles(dir, base) {
  const out = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    const rel = path.join(base, entry.name)
    if (entry.isDirectory()) {
      out.push(...listFiles(full, rel))
    } else if (entry.isFile()) {
      out.push(rel)
    }
  }
  return out
}

const files = listFiles(appDir, '')
if (files.length === 0) {
  console.error('app/ 目录为空，请先构建')
  process.exit(1)
}

const totalBytes = files.reduce((acc, f) => acc + fs.statSync(path.join(appDir, f)).size, 0)
console.log(`版本：v${version}`)
console.log(`包含 ${files.length} 个文件，共 ${(totalBytes / 1024 / 1024).toFixed(1)} MB`)

if (dryRun) {
  for (const f of files.slice(0, 40)) console.log(`  ${f}`)
  if (files.length > 40) console.log(`  … 其余 ${files.length - 40} 个`)
  console.log('（dry-run：未生成 zip）')
  process.exit(0)
}

// 用系统 tar（Windows 10+ bsdtar）打包 zip：-a 按扩展名自动选压缩器
if (fs.existsSync(zipPath)) fs.rmSync(zipPath, { force: true })
execFileSync('tar', ['-a', '-c', '-f', zipPath, ...files.map((f) => `./${f}`)], { cwd: appDir, stdio: 'inherit' })
const size = fs.statSync(zipPath).size
console.log(`更新包已生成：${zipPath}（${(size / 1024 / 1024).toFixed(1)} MB）`)

// 生成 SHA256SUMS（客户端下载后校验；随 Release 一并上传）
const checksum = crypto.createHash('sha256').update(fs.readFileSync(zipPath)).digest('hex')
const sumsPath = path.join(deliverRoot, 'SHA256SUMS')
fs.writeFileSync(sumsPath, `${checksum}  ${path.basename(zipPath)}\n`)
console.log(`SHA256SUMS 已生成：${sumsPath}（${checksum}）`)

console.log('发布：在 GitHub 创建 Release（tag v' + version + '）并上传 zip 与 SHA256SUMS 作为资产，客户端即可检测到更新。')
