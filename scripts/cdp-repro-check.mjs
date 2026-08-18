/** 复现检查：主界面导航 + 设置模型保存 + dsh 界面状态。 */
const port = process.argv[2] ?? '9226'
const list = await fetch(`http://127.0.0.1:${port}/json`).then((r) => r.json())
const page = list.find((t) => t.type === 'page' && t.url.includes('index.html'))
const ws = new WebSocket(page.webSocketDebuggerUrl)
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
console.log('WIZARD:', await ev(`document.body.innerText.includes('首次启动引导')`))
console.log('NAV_BTNS:', await ev(`JSON.stringify([...document.querySelectorAll('button')].map(b => b.innerText.trim().slice(0, 14)).filter(Boolean).slice(0, 15))`))
console.log('BODY_HEAD:', await ev(`document.body.innerText.slice(0, 250)`))
ws.close()
process.exit(0)
