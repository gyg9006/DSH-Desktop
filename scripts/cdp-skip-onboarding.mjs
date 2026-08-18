/** 验证：无 Key 首次启动服务 → dsh 引导被跳过（注入隐藏）。 */
const list = await fetch('http://127.0.0.1:9222/json').then((r) => r.json())
const page = list.find((t) => t.type === 'page' && t.url.includes('index.html'))
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((r) => (ws.onopen = r))
let id = 0
function ev(expression, timeout = 60000) {
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

// 0. 确保无 Key（清理）
await ev(`window.dshw.modelsKeyDelete('deepseek')`)
await wait(400)
// 1. 切核心工作台 + 启动服务（无 Key）
await ev(`(() => { const b = [...document.querySelectorAll('aside button')].find(x => (x.title||'').includes('核心工作台')); if (b) b.click(); return 'ok'; })()`)
await wait(600)
await ev(`window.dshw.getServiceStatus().then(async s => { if (s.status === 'running') await window.dshw.stopService(); return 'ok'; })`)
await wait(1500)
await ev(`window.dshw.startService()`)
let wvTarget = null
for (let i = 0; i < 45; i++) {
  await wait(1500)
  const targets = await fetch('http://127.0.0.1:9222/json').then((r) => r.json()).catch(() => [])
  wvTarget = targets.find((t) => t.type === 'webview')
  if (wvTarget) break
}
check('服务 + webview', !!wvTarget)
if (wvTarget) {
  const wvWs = new WebSocket(wvTarget.webSocketDebuggerUrl)
  await new Promise((res) => (wvWs.onopen = res))
  let wid = 0
  const wvEval = (expression, timeout = 45000) => new Promise((resolve, reject) => {
    const my = ++wid
    const timer = setTimeout(() => reject(new Error('wv timeout')), timeout)
    const handler = (e) => {
      const m = JSON.parse(e.data)
      if (m.id === my) { clearTimeout(timer); wvWs.removeEventListener('message', handler); resolve(m.result?.result?.value) }
    }
    wvWs.addEventListener('message', handler)
    wvWs.send(JSON.stringify({ id: my, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true } }))
  })
  await wait(10000)
  // 检查：引导对话框是否隐藏 + 页面是否可交互
  const t = await wvEval(`document.body.innerText`)
  console.log('  页面含引导文案:', t.includes('保存并继续') || t.includes('稍后配置') || t.includes('配置 DeepSeek 官方模型'))
  check('无「保存并继续」引导', !t.includes('保存并继续'))
  // 检查 root inert 是否解除
  const inertCount = await wvEval(`document.querySelectorAll('[inert]').length`)
  console.log('  剩余 inert 元素:', inertCount)
  check('应用根 inert 已解除', inertCount === 0, String(inertCount))
  // 引导 modal 是否隐藏
  const modalVisible = await wvEval(`(() => { const m = [...document.querySelectorAll('[role="dialog"]')].find(d => (d.textContent||'').includes('保存并继续') || (d.textContent||'').includes('稍后配置')); return m ? (m.offsetParent !== null ? 'visible' : 'hidden') : 'no-modal'; })()`)
  console.log('  引导模态:', modalVisible)
  check('引导模态隐藏或不存在', modalVisible !== 'visible', modalVisible)
  wvWs.close()
}
await ev(`window.dshw.getServiceStatus().then(async s => { if (s.status === 'running') await window.dshw.stopService(); return 'ok'; })`)
console.log(`\n引导跳过验证: 通过 ${passed} | 失败 ${failed}`)
ws.close()
process.exit(failed ? 1 : 0)
