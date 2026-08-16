/**
 * electron-builder dir 目标默认输出到 <output>/win-unpacked/，
 * 本脚本将其内容平铺到交付目录的 app/（最终形态：app/DSH 桌面.exe + app/resources/）。
 * 源码目录与交付目录分离：源码=dsh-workbench-src，交付=../DSH-Desktop。
 *
 * 安全：仅移动 win-unpacked 内的条目（白名单式源目录），并对目标 app/ 做
 * 存在性校验（必须是 app 目录形态：含 resources 或可执行文件），避免误删交付数据。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const appDir = path.join(projectRoot, '..', 'DSH-Desktop', 'app')
const unpacked = path.join(appDir, 'win-unpacked')

if (!fs.existsSync(unpacked)) {
  console.error(`未找到 ${unpacked}，请先执行 electron-builder --win dir`)
  process.exit(1)
}

// 校验目标 app/ 形态：应包含 resources/ 或 .exe（防误删工作文件夹）
const appHasArtifacts = fs.existsSync(path.join(appDir, 'resources')) ||
  (fs.existsSync(appDir) && fs.readdirSync(appDir).some((f) => /\.exe$/i.test(f)))
if (fs.existsSync(appDir) && !appHasArtifacts) {
  console.error(`目标目录 ${appDir} 不是 app 目录形态（缺 resources/ 或 .exe），拒绝平铺`)
  process.exit(1)
}

for (const entry of fs.readdirSync(unpacked)) {
  const from = path.join(unpacked, entry)
  const to = path.join(appDir, entry)
  if (fs.existsSync(to)) fs.rmSync(to, { recursive: true, force: true })
  fs.renameSync(from, to)
}
fs.rmdirSync(unpacked)

// 清理 electron-builder 生成的辅助文件
for (const extra of ['builder-effective-config.yaml', 'builder-debug.yml']) {
  const p = path.join(appDir, extra)
  if (fs.existsSync(p)) fs.rmSync(p, { force: true })
}

console.log('打包产物已平铺到交付目录 app/：')
for (const entry of fs.readdirSync(appDir)) {
  console.log(`  app/${entry}`)
}
