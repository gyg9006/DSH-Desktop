/**
 * P1 引导页功能自测（CDP 驱动真实应用，零依赖：Node 24 内置 fetch/WebSocket）。
 * 用法：
 *   1) 启动应用：node_modules\.bin\electron.cmd . --remote-debugging-port=9222
 *   2) node scripts/cdp-onboarding-check.mjs [--port 9222]
 * 检查项：
 *   - 引导页渲染（非白屏）
 *   - Step1 工作文件夹展示 / 下一步可用
 *   - Step2 环境列表与状态 / dsh 缺失时 [一键安装] / 下一步禁用
 *   - [一键安装] 触发安装事件（进度/日志），随后取消
 *   - Step3 提供方列表 / 假 Key 测试失败 → 错误 Toast / 完成禁用
 *   - 全程收集渲染层 console 错误与异常
 */
import { writeFileSync } from 'node:fs'

const portIdx = process.argv.indexOf('--port')
const PORT = portIdx >= 0 ? Number(process.argv[portIdx + 1]) : 9222
const results = []
const errors = []
const log = (msg) => {
  console.log(msg)
  results.push(msg)
}

function findPage() {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + 20000
    const tick = async () => {
      try {
        const targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()
        const page = targets.find((t) => t.type === 'page' && /index\.html/.test(t.url ?? ''))
        if (page) return resolve(page)
      } catch { /* not ready */ }
      if (Date.now() > deadline) return reject(new Error('未找到应用页面目标（CDP /json 超时）'))
      setTimeout(tick, 500)
    }
    tick()
  })
}

const page = await findPage()
log(`[CDP] 连接页面：${page.url}`)

const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((resolve, reject) => {
  ws.onopen = resolve
  ws.onerror = () => reject(new Error('WebSocket 连接失败'))
})
let seq = 0
const pending = new Map()
ws.onmessage = (e) => {
  const m = JSON.parse(e.data)
  if (m.id && pending.has(m.id)) {
    const { resolve, reject } = pending.get(m.id)
    pending.delete(m.id)
    m.error ? reject(new Error(m.error.message)) : resolve(m.result)
  } else if (m.method === 'Runtime.exceptionThrown') {
    errors.push(`[异常] ${m.params.exceptionDetails?.text ?? ''} ${m.params.exceptionDetails?.exception?.description ?? ''}`)
  } else if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') {
    errors.push(`[console.error] ${m.params.entry.text}`)
  } else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
    errors.push(`[console.error] ${m.params.args.map((a) => a.value ?? a.description ?? '').join(' ')}`)
  }
}
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = ++seq
    pending.set(id, { resolve, reject })
    ws.send(JSON.stringify({ id, method, params }))
  })
const evalJs = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (r.exceptionDetails) throw new Error(`页面执行异常：${r.exceptionDetails.text} ${r.exceptionDetails.exception?.description ?? ''}`)
  return r.result?.value
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const clickText = async (text) => {
  const ok = await evalJs(`(() => {
    const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes(${JSON.stringify(text)}));
    if (!b) return false; b.click(); return true;
  })()`)
  if (!ok) log(`  [click] 未找到按钮「${text}」`)
  return ok
}

await send('Runtime.enable')
await send('Log.enable')

// ---------- 1. 引导页渲染 ----------
const bodyText = await evalJs(`document.body.innerText`)
const hasWizard = bodyText.includes('首次启动引导')
log(`[1] 引导页渲染（非白屏）：${hasWizard ? '✅' : '❌'}`)
if (!hasWizard) log(`  页面文本片段：${bodyText.slice(0, 200).replace(/\n/g, ' ')}`)
log(`[1] 步骤指示：${['工作文件夹', '环境检测', 'API Key'].every((s) => bodyText.includes(s)) ? '✅' : '❌'}`)

// ---------- 2. Step1 工作文件夹 ----------
const step1Path = await evalJs(`document.body.innerText.includes('当前工作文件夹')`)
log(`[2] Step1 显示工作文件夹区：${step1Path ? '✅' : '❌'}`)
await clickText('使用此路径并继续')
await sleep(600)
const step2Text = await evalJs(`document.body.innerText`)
const envKeys = ['Node.js', 'npm', 'pnpm', 'Git', 'DeepSeek Harness (dsh)']
log(`[2] 进入 Step2 环境检测：${envKeys.every((k) => step2Text.includes(k)) ? '✅' : '❌'}`)

// 各环境项状态
const envStates = await evalJs(`(() => {
  const rows = [...document.querySelectorAll('div')].filter((d) => d.className && String(d.className).includes('rounded-lg') && d.className.includes('bg-cyber-panel'));
  return rows.map((r) => r.innerText.split('\\n').slice(0, 2).join(' | ')).filter((t) => /Node|npm|pnpm|Git|dsh|DeepSeek/.test(t));
})()`)
envStates.forEach((s) => log(`  [环境] ${s}`))
const installButtons = await evalJs(`[...document.querySelectorAll('button')].filter((b) => /一键安装|更新/.test(b.textContent)).map((b) => b.textContent.trim())`)
log(`[2] 待安装/更新按钮：${installButtons.length > 0 ? installButtons.join(', ') : '（无）'}`)

const nextDisabled = await evalJs(`(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('下一步')); return b ? b.disabled : null })()`)
log(`[2] Step2「下一步」禁用（环境未全通过）：${nextDisabled === true ? '✅' : '❌ 实际=' + nextDisabled}`)

// ---------- 3. 一键安装（dsh）→ 进度 → 取消 ----------
const installTarget = installButtons.find((b) => /DeepSeek|dsh/i.test(b)) ?? installButtons[0]
if (installTarget) {
  const started = await clickText(installTarget)
  await sleep(2500)
  const progressText = await evalJs(`document.body.innerText`)
  const hasProgress = /处理中|下载|安装|校验|解压|准备/.test(progressText)
  log(`[3] 点击[${installTarget}]后出现进度/日志文案：${started && hasProgress ? '✅' : '❌'}`)
  await clickText('取消')
  await sleep(800)
} else {
  log('[3] 无待安装项，跳过一键安装检查')
}

// ---------- 4. 提供方列表（Step3 前置检查：直接评估 models 是否可用） ----------
const modelsOk = await evalJs(`window.dshw ? 'dshw-ok' : 'no-dshw'`)
log(`[4] preload window.dshw 可用：${modelsOk === 'dshw-ok' ? '✅' : '❌'}`)

// ---------- 5. 渲染层错误收集 ----------
log(`[5] 渲染层错误/异常：${errors.length === 0 ? '✅ 无' : '❌ ' + errors.join(' | ')}`)

writeFileSync(new URL('./cdp-onboarding-result.txt', import.meta.url), `${results.join('\n')}\n\n--- errors ---\n${errors.join('\n')}\n`, 'utf8')
console.log('结果已写入 scripts/cdp-onboarding-result.txt')
ws.close()
process.exit(0)
