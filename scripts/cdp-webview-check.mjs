/** 连 webview target，检查 dsh web 的模型选择器与 API Key 提示。 */
const port = process.argv[2] ?? '9229'
const list = await fetch(`http://127.0.0.1:${port}/json`).then((r) => r.json())
console.log('TARGETS:', list.map((t) => `${t.type}:${t.url.slice(0, 70)}`).join('\n'))
// 找 webview target（guest 或 url 含 localhost:3081）
const guest = list.find((t) => (t.type === 'webview' || t.type === 'page') && t.url.includes('3081'))
if (!guest) {
  console.log('NO_WEBVIEW')
  process.exit(0)
}
const ws = new WebSocket(guest.webSocketDebuggerUrl)
await new Promise((res, rej) => {
  ws.onopen = res
  ws.onerror = () => rej(new Error('ws'))
})
let id = 0
function ev(expression, to = 15000) {
  return new Promise((resolve) => {
    const my = ++id
    const t = setTimeout(() => {
      ws.removeEventListener('message', h)
      resolve('TIMEOUT')
    }, to)
    const h = (e) => {
      const m = JSON.parse(e.data)
      if (m.id === my) {
        clearTimeout(t)
        ws.removeEventListener('message', h)
        resolve(m.result?.result?.value ?? JSON.stringify(m.result?.exceptionDetails ?? ''))
      }
    }
    ws.addEventListener('message', h)
    ws.send(JSON.stringify({ id: my, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true } }))
  })
}
const body = await ev('document.body ? document.body.innerText.slice(0, 800) : "NO_BODY"')
console.log('DSH_WEB_BODY:', typeof body === 'string' ? body.slice(0, 600) : body)
ws.close()
process.exit(0)
