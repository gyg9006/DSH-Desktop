/** 点启动服务并监控（避免 shell 转义问题）。 */
const port = process.argv[2] ?? '9223'
const list = await fetch(`http://127.0.0.1:${port}/json`).then((r) => r.json())
const page = list.find((t) => t.type === 'page' && t.url.includes('index.html'))
if (!page) {
  console.log('NO_PAGE')
  process.exit(1)
}
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((res, rej) => {
  ws.onopen = res
  ws.onerror = () => rej(new Error('ws'))
})
let id = 0
function ev(expression, to = 10000) {
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
console.log('click:', await ev(`(() => { const b = [...document.querySelectorAll('button')].find(x => x.innerText.includes('启动服务')); if (!b) return 'NO_BTN'; b.click(); return 'CLICKED' })()`))
for (let i = 0; i < 12; i++) {
  await new Promise((r) => setTimeout(r, 5000))
  const st = await ev('document.body.innerText.slice(-200)')
  console.log(`poll#${i + 1}:`, typeof st === 'string' ? st.split('\n').filter(Boolean).slice(-3).join(' | ') : st)
}
ws.close()
process.exit(0)
