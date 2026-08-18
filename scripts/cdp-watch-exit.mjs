/** 点启动服务，全程监控 renderer 存活与主进程反应。 */
const port = process.argv[2] ?? '9243'
async function cdpEval(expression, to = 30000) {
  const list = await fetch(`http://127.0.0.1:${port}/json`).then((r) => r.json())
  const page = list.find((t) => t.type === 'page' && t.url.includes('index.html'))
  if (!page) return 'NO_PAGE'
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((res, rej) => {
    ws.onopen = res
    ws.onerror = () => rej(new Error('ws'))
  })
  return new Promise((resolve) => {
    let my = 0
    const t = setTimeout(() => { ws.close(); resolve('TIMEOUT') }, to)
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data)
      if (m.id === my) {
        clearTimeout(t)
        ws.close()
        resolve(m.result?.result?.value ?? JSON.stringify(m.result?.exceptionDetails ?? ''))
      }
    }
    my = 1
    ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true } }))
  })
}
console.log('PING renderer:', await cdpEval('1+1', 8000))
console.log('START:', await cdpEval(`window.dshw.startService().then(r => JSON.stringify(r)).catch(e => 'ERR ' + String(e))`, 20000))
wsclose()
process.exit(0)
