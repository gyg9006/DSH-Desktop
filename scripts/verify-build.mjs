/**
 * 构建产物校验（P3 修复版）：electron-builder 打包 + 平铺后自动执行。
 *
 * 校验项（对照验收清单 1-8）：
 *   1. 可执行文件名必须为纯 ASCII DSH-Desktop.exe（正则 /^DSH-Desktop\.exe$/i）；
 *   2. resources/portable-env/ 完整性：node/node.exe、git/cmd/git.exe、pnpm/pnpm.exe、
 *      dsh-cli/package.json 全部存在且可执行/可解析；
 *   3. env-manifest.json 有效且 platform 与当前平台一致。
 * 任一失败 → 退出码 1（构建失败）；校验日志写入 <交付根>/verify-build.log 留档。
 *
 * 用法：
 *   node scripts/verify-build.mjs            # 校验默认交付目录 ../DSH-Desktop/app
 *   node scripts/verify-build.mjs --app <路径>
 *   node scripts/verify-build.mjs --skip-pnpm  # 本地调试跳过 pnpm（GitHub 慢速源；CI 必须全量）
 */
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const argApp = process.argv.indexOf('--app')
const appDir = path.resolve(argApp >= 0 ? process.argv[argApp + 1] : path.join(projectRoot, '..', 'DSH-Desktop', 'app'))
const skipPnpm = process.argv.includes('--skip-pnpm')

const results = []
const logLine = (status, desc, detail) => {
  const line = `[${new Date().toISOString()}] ${status}  ${desc}${detail ? ` — ${detail}` : ''}`
  results.push(line)
  console.log(line)
}
const pass = (desc, detail) => logLine('PASS', desc, detail)
const fail = (desc, detail) => logLine('FAIL', desc, detail)

// 运行可执行文件并返回 stdout 首行；失败返回 null
function run(exec, args) {
  try {
    const r = spawnSync(exec, args, { encoding: 'utf8', timeout: 60000, windowsHide: true })
    if (r.status !== 0) return null
    return r.stdout.trim().split('\n')[0]
  } catch {
    return null
  }
}

console.log(`[verify-build] 校验目录：${appDir}`)
if (!fs.existsSync(appDir)) {
  console.error(`[verify-build] 未找到 ${appDir}，请先构建（npm run pack:dir）`)
  process.exit(1)
}

// ---- 1. 可执行文件名（Bug 2 校验） ----
const exes = fs.readdirSync(appDir).filter((f) => /\.exe$/i.test(f) && fs.statSync(path.join(appDir, f)).isFile())
const mainExe = exes.find((f) => /^DSH-Desktop\.exe$/i.test(f))
if (mainExe) pass('可执行文件名 DSH-Desktop.exe', `发现：${exes.join(', ')}`)
else fail('可执行文件名必须为 DSH-Desktop.exe', `实际：${exes.join(', ')}`)

// ---- 2. 内置便携环境完整性（Bug 1 校验，对照验收清单 1-4） ----
// 注：当前发布渠道为 Windows，以下校验固定使用 Windows 可执行文件名；
// 未来启用 macOS/Linux 构建时按平台替换（node/bin/node、git/bin/git、pnpm/pnpm）。
const envDir = path.join(appDir, 'resources', 'portable-env')
if (!fs.existsSync(envDir)) {
  fail('resources/portable-env/ 存在', '目录缺失（extraResources 未生效或 prepare:env 未执行）')
} else {
  const nodeExe = path.join(envDir, 'node', 'node.exe')
  const gitExe = path.join(envDir, 'git', 'cmd', 'git.exe')
  const pnpmExe = path.join(envDir, 'pnpm', 'pnpm.exe')
  const dshPkg = path.join(envDir, 'dsh-cli', 'package.json')
  const manifestPath = path.join(envDir, 'env-manifest.json')

  const nodeVer = run(nodeExe, ['--version'])
  if (nodeVer) pass('node/node.exe 存在且可执行', nodeVer)
  else fail('node/node.exe 存在且可执行', nodeExe)

  // VC++ 运行库 DLL（Win10 LTSC 精简版缺失会导致 node.exe 无法启动）
  const vcDlls = ['vcruntime140.dll', 'vcruntime140_1.dll', 'msvcp140.dll']
  const missingDlls = vcDlls.filter((d) => !fs.existsSync(path.join(envDir, 'node', d)))
  if (missingDlls.length === 0) pass('node/ 随包 VC++ 运行库 DLL（vcruntime140 等）', vcDlls.join(', '))
  else fail('node/ 随包 VC++ 运行库 DLL（vcruntime140 等）', `缺失：${missingDlls.join(', ')}`)

  const gitVer = run(gitExe, ['--version'])
  if (gitVer) pass('git/cmd/git.exe 存在且可执行（完整 MinGit）', gitVer)
  else fail('git/cmd/git.exe 存在且可执行', gitExe)

  if (skipPnpm) {
    console.log('[verify-build] --skip-pnpm：跳过 pnpm 校验（CI 必须全量）')
  } else {
    const pnpmVer = run(pnpmExe, ['--version'])
    if (pnpmVer) pass('pnpm/pnpm.exe 存在且可执行', pnpmVer)
    else fail('pnpm/pnpm.exe 存在且可执行', pnpmExe)
  }

  const dshOk = fs.existsSync(dshPkg) && (() => {
    try {
      return Boolean(JSON.parse(fs.readFileSync(dshPkg, 'utf8')).version)
    } catch {
      return false
    }
  })()
  if (dshOk) pass('dsh-cli/ 存在（package.json + version）', dshPkg)
  else fail('dsh-cli/ 存在（package.json + version）', dshPkg)

  // env-manifest.json 有效性 + platform 匹配
  let manifestOk = false
  try {
    const m = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
    manifestOk = Boolean(m && typeof m === 'object' && (!m.platform || m.platform === process.platform))
  } catch {
    manifestOk = false
  }
  if (manifestOk) pass('env-manifest.json 有效且 platform 匹配', manifestPath)
  else fail('env-manifest.json 有效且 platform 匹配', manifestPath)
}

// ---- 3. 汇总 ----
const failed = results.filter((l) => l.includes('FAIL'))
const logPath = path.join(projectRoot, '..', 'DSH-Desktop', 'verify-build.log')
try {
  fs.writeFileSync(logPath, results.join('\n') + '\n')
  console.log(`\n[verify-build] 日志已留档：${logPath}`)
} catch (error) {
  console.log(`\n[verify-build] 日志写入失败：${String(error)}`)
}

if (failed.length > 0) {
  console.error(`\n[verify-build] 校验未通过（${failed.length} 项失败）`)
  process.exit(1)
}
console.log(`\n[verify-build] 全部校验通过（${results.length} 项）`)
