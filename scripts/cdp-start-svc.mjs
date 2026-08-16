/** 启动服务并等待 dsh webview 出现。 */
const DEBUG_PORT = 9222
const list = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json`).then((r) => r.json())
const page = list.find((t) => t.type === 'page' && t.url.includes('index.html'))
if (!page) throw new Error('no page')
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = () => reject(new Error('ws error')) })
let id = 0
function ev(expression, timeout = 15000) {
  return new Promise((resolve) => {
    const my = ++id
    const timer = setTimeout(() => { ws.removeEventListener('message', handler); resolve('EVAL_TIMEOUT') }, timeout)
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
const clicked = await ev(`(() => { const btns = [...document.querySelectorAll('button')].filter(b => { const t = (b.innerText||'').trim(); return t.includes('一键启动服务') || t.includes('开始对话') || t === '启动'; }); if (!btns.length) return 'NO_BTN'; btns[0].click(); return 'clicked:' + btns[0].innerText.trim(); })()`)
console.log('启动:', clicked)
for (let i = 0; i < 40; i++) {
  await wait(2000)
  const targets = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json`).then((r) => r.json()).catch(() => [])
  const wv = targets.filter((t) => t.type === 'webview')
  if (wv.length) { console.log('webview:', wv[0].url); break }
}
ws.close()
process.exit(0)
