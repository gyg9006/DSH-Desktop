/** T14 再次启动服务。 */
const port = process.argv[2] ?? '9229'
const list = await fetch(`http://127.0.0.1:${port}/json`).then((r) => r.json())
const page = list.find((t) => t.type === 'page' && t.url.includes('index.html'))
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((res, rej) => {
  ws.onopen = res
  ws.onerror = () => rej(new Error('ws'))
})
let id = 0
function ev(expression, to = 30000) {
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
console.log('T14 再次启动:', await ev(`window.dshw.startService().then(r => JSON.stringify(r)).catch(e => 'ERR')`, 25000))
await new Promise((r) => setTimeout(r, 8000))
const body = await ev('document.body.innerText.slice(-150)')
console.log('T14 状态栏:', typeof body === 'string' ? body.split('\n').filter(Boolean).slice(-3).join(' | ') : body)
ws.close()
process.exit(0)
