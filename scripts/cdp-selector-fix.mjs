/** 修复验证：不切视图，配置后直接打开选择器（打开时刷新）。 */
const list = await fetch('http://127.0.0.1:9222/json').then((r) => r.json())
const page = list.find((t) => t.type === 'page' && t.url.includes('index.html'))
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((r) => (ws.onopen = r))
let id = 0
function ev(expression, timeout = 20000) {
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
// 切到核心工作台（选择器依赖 DSHCore 挂载）
await ev(`(() => { const b = [...document.querySelectorAll('aside button')].find(x => (x.title||'').includes('核心工作台')); if (b) b.click(); return 'ok'; })()`)
await wait(800)
// 场景：应用已在核心工作台（选择器 mount 时配置为空）→ 现在配置模型 → 直接打开选择器（不切视图）
await ev(`window.dshw.modelsProviderSet({ providerId: 'deepseek', patch: { enabled: true, models: ['deepseek-chat', 'deepseek-reasoner'], defaultChat: 'deepseek-chat' } })`)
await wait(400)
// 选择器按钮（尚未刷新，可能显示"选择模型"）
const before = await ev(`(() => { const b = [...document.querySelectorAll('button')].find(x => x.innerText.includes('选择模型') || x.innerText.includes('deepseek')); return b ? b.innerText : 'NO_BTN'; })()`)
console.log('  打开前按钮:', before)
// 打开（触发刷新）
await ev(`(() => { const b = [...document.querySelectorAll('button')].find(x => x.innerText.includes('选择模型') || x.innerText.includes('deepseek')); if (b) b.click(); return 'ok'; })()`)
await wait(800)
console.log('  下拉选项:', await ev(`(() => { const c = [...document.querySelectorAll('div')].find(x => x.className.includes('absolute') && x.className.includes('top-8')); return c ? JSON.stringify([...c.querySelectorAll('button')].map(b => b.innerText.split('\\n')[0])) : 'NO_CONTAINER'; })()`))
const opts = await ev(`(() => { const c = [...document.querySelectorAll('div')].find(x => x.className.includes('absolute') && x.className.includes('top-8')); return c ? c.querySelectorAll('button').length : 0; })()`)
check('打开后选项 ≥2', opts >= 2, String(opts))
// 选择 deepseek-reasoner
await ev(`(() => { const c = [...document.querySelectorAll('div')].find(x => x.className.includes('absolute') && x.className.includes('top-8')); const b = [...c.querySelectorAll('button')].find(x => x.innerText.includes('deepseek-reasoner')); if (b) b.click(); return 'ok'; })()`)
await wait(600)
const cfg = await ev(`window.dshw.modelsGet().then(v => JSON.stringify(v.providers.deepseek.defaultChat))`)
check('选择生效（defaultChat 更新）', cfg === '"deepseek-reasoner"', cfg)
// 同步 dsh apiConfig
const api = await ev(`window.dshw.getApiConfig().then(c => JSON.stringify(c.model))`)
console.log('  dsh apiConfig.model:', api)

// 清理：还原 deepseek 配置
await ev(`window.dshw.modelsProviderSet({ providerId: 'deepseek', patch: { defaultChat: 'deepseek-chat' } })`)

console.log(`\n选择器修复验证: 通过 ${passed} | 失败 ${failed}`)
ws.close()
process.exit(failed ? 1 : 0)
