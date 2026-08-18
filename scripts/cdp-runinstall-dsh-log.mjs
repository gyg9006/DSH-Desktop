/** 订阅 onInstallEvent + 调 runInstall('dsh')，捕获 GUI 内 npm install 完整输出。 */
const port = process.argv[2] ?? '9224'
const list = await fetch(`http://127.0.0.1:${port}/json`).then((r) => r.json())
const page = list.find((t) => t.type === 'page' && t.url.includes('index.html'))
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((res, rej) => {
  ws.onopen = res
  ws.onerror = () => rej(new Error('ws'))
})
let id = 0
function ev(expression, to = 420000) {
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
// 先订阅事件收集，再触发安装（结果在 events 里）
const out = await ev(`(async () => {
  const events = []
  window.__evLog = events
  window.dshw.onInstallEvent((e) => events.push(e))
  const r = await window.dshw.runInstall('dsh', 'install')
  return JSON.stringify({ result: r, events: events.slice(-40) })
})()`)
console.log('OUT:', out)
ws.close()
process.exit(0)
