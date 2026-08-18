/** 测量 #2：收起桌面侧边栏前后，webview 与 guest 内容布局。 */
const DEBUG_PORT = 9222
const list = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json`).then((r) => r.json())
const page = list.find((t) => t.type === 'page' && t.url.includes('index.html'))
if (!page) throw new Error('未找到应用页面')
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((resolve, reject) => {
  ws.onopen = resolve
  ws.onerror = () => reject(new Error('ws error'))
})
let id = 0
function ev(expression, timeout = 30000) {
  return new Promise((resolve) => {
    const my = ++id
    const timer = setTimeout(() => {
      ws.removeEventListener('message', handler)
      resolve('EVAL_TIMEOUT')
    }, timeout)
    const handler = (e) => {
      const m = JSON.parse(e.data)
      if (m.id === my) {
        clearTimeout(timer)
        ws.removeEventListener('message', handler)
        resolve(m.result?.result?.value ?? JSON.stringify(m.result?.exceptionDetails ?? ''))
      }
    }
    ws.addEventListener('message', handler)
    ws.send(JSON.stringify({ id: my, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true } }))
  })
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const g = (expr, timeout = 30000) => ev(`(async () => { const wv = document.querySelector('webview'); return String(await wv.executeJavaScript(${JSON.stringify(expr)}, true, ${timeout})) })()`, timeout + 3000)
const check = (n, ok, d = '') => console.log(`${ok ? '✓' : '✗'} ${n}${d ? '  ' + d : ''}`)

// 展开态测量
const le = await ev(`(async () => {
  const wv = document.querySelector('webview')
  const wr = wv.getBoundingClientRect()
  return JSON.stringify({ wvX: Math.round(wr.x), wvW: Math.round(wr.width), winW: window.innerWidth })
})()`)
console.log('展开态:', le)
await ev(`(() => { const b = document.querySelector('aside button[aria-label="收起或展开任务栏"]'); if (b) b.click(); return 'ok' })()`)
await wait(1200)
const lc = await ev(`(async () => {
  const wv = document.querySelector('webview')
  const wr = wv.getBoundingClientRect()
  return JSON.stringify({ wvX: Math.round(wr.x), wvW: Math.round(wr.width), winW: window.innerWidth })
})()`)
console.log('收起态:', lc)
// guest 内容是否填满 webview
const guest = await g(`(() => {
  const body = document.body
  const html = document.documentElement
  const composer = [...document.querySelectorAll('textarea, [contenteditable]')].map(el => { const r = el.getBoundingClientRect(); return { x: Math.round(r.x), w: Math.round(r.width), right: Math.round(r.right) } })
  return JSON.stringify({ scrollW: html.scrollWidth, clientW: html.clientWidth, bodyW: body.getBoundingClientRect().width, composer })
})()`)
console.log('guest 布局:', guest)
const le2 = JSON.parse(le)
const lc2 = JSON.parse(lc)
check('#2 webview 在收起后覆盖到窗口右缘', lc2.wvX + lc2.wvW >= lc2.winW - 4, `x=${lc2.wvX} w=${lc2.wvW} win=${lc2.winW}`)
const gg = JSON.parse(guest)
check('#2 guest 内容填满 webview（无左空白）', gg.composer[0] ? gg.composer[0].x < 30 : true, guest)
await ev(`(() => { const b = document.querySelector('aside button[aria-label="收起或展开任务栏"]'); if (b) b.click(); return 'ok' })()`)
await wait(600)
ws.close()
process.exit(0)
