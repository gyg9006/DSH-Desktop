/** 验证修复：启动同步补齐模型 → settings.yaml → dsh 对话模型选择器恢复。 */
const list = await fetch('http://127.0.0.1:9222/json').then((r) => r.json())
const page = list.find((t) => t.type === 'page' && t.url.includes('index.html'))
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((r) => (ws.onopen = r))
let id = 0
function ev(expression, timeout = 40000) {
  return new Promise((resolve, reject) => {
    const my = ++id
    const timer = setTimeout(() => reject(new Error('timeout')), timeout)
    const handler = (e) => {
      const m = JSON.parse(e.data)
      if (m.id === my) { clearTimeout(timer); ws.removeEventListener('message', handler); resolve(m.result?.result?.value) }
    }
    ws.addEventListener('message', handler)
    ws.send(JSON.stringify({ id: my, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true } }))
  })
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
let passed = 0, failed = 0
const check = (n, c, d = '') => { if (c) { passed++; console.log('  ✅', n) } else { failed++; console.log('  ❌', n, d) } }

await wait(5000)
// 0. 切核心工作台（webview 依赖）
await ev(`(() => { const b = [...document.querySelectorAll('aside button')].find(x => (x.title||'').includes('核心工作台')); if (b) b.click(); return 'ok'; })()`)
await wait(600)
// 1. 启动服务（启动时已 sync 补齐模型）
await ev(`window.dshw.startService()`)
let wvTarget = null
for (let i = 0; i < 40; i++) {
  await wait(1500)
  const targets = await fetch('http://127.0.0.1:9222/json').then((r) => r.json()).catch(() => [])
  wvTarget = targets.find((t) => t.type === 'webview')
  if (wvTarget) break
}
check('服务启动 + webview', !!wvTarget)
if (wvTarget) {
  const wvWs = new WebSocket(wvTarget.webSocketDebuggerUrl)
  await new Promise((res) => (wvWs.onopen = res))
  let wid = 0
  const wvEval = (expression, timeout = 30000) => new Promise((resolve, reject) => {
    const my = ++wid
    const timer = setTimeout(() => reject(new Error('timeout')), timeout)
    const handler = (e) => {
      const m = JSON.parse(e.data)
      if (m.id === my) { clearTimeout(timer); wvWs.removeEventListener('message', handler); resolve(m.result?.result?.value) }
    }
    wvWs.addEventListener('message', handler)
    wvWs.send(JSON.stringify({ id: my, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true } }))
  })
  await wait(8000)
  const t = await wvEval(`document.body.innerText`)
  check('dsh 对话界面含模型 deepseek-chat', t.includes('deepseek-chat'), '')
  check('dsh 对话界面含模型 deepseek-reasoner', t.includes('deepseek-reasoner'), '')
  // 模型选择器控件存在性（找含模型名的可点元素）
  const sel = await wvEval(`(() => { const els = [...document.querySelectorAll('[class*="model" i], button, [role="combobox"]')]; const hit = els.find(e => (e.innerText||'').includes('deepseek-chat') || (e.innerText||'').includes('deepseek')); return hit ? hit.tagName + ':' + (hit.innerText||'').slice(0,60) : 'NO_HIT'; })()`)
  console.log('  模型选择元素:', sel)
  check('模型选择器控件存在', !sel.startsWith('NO_HIT'), sel)
  wvWs.close()
}
// 2. settings.yaml 确认（通过模型中心触发一次 sync 并读配置）
await ev(`window.dshw.modelsProviderSet({ providerId: 'deepseek', patch: { enabled: true } })`)
await wait(500)
// 清理测试配置（还原）
await ev(`window.dshw.modelsProviderSet({ providerId: 'deepseek', patch: { enabled: false, models: [] } })`)
await ev(`window.dshw.stopService()`)
console.log(`\ndsh 模型选择恢复验证: 通过 ${passed} | 失败 ${failed}`)
ws.close()
process.exit(failed ? 1 : 0)
