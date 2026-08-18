/** 同步 push/pull 验证。 */
const DEBUG_PORT = 9222
let page
for (let i = 0; i < 12; i++) {
  try {
    const list = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json`, { signal: AbortSignal.timeout(3000) }).then((r) => r.json())
    page = list.find((t) => t.type === 'page' && t.url.includes('index.html'))
    if (page) break
  } catch {
    /* retry */
  }
  await new Promise((r) => setTimeout(r, 3000))
}
if (!page) throw new Error('应用页面未就绪')
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((resolve, reject) => {
  ws.onopen = resolve
  ws.onerror = () => reject(new Error('ws error'))
})
let id = 0
function ev(expression, timeout = 40000) {
  return new Promise((resolve) => {
    const my = ++id
    const timer = setTimeout(() => {
      ws.removeEventListener('message', handler)
      resolve('TIMEOUT')
    }, timeout)
    const handler = (e) => {
      const m = JSON.parse(e.data)
      if (m.id === my) {
        clearTimeout(timer)
        ws.removeEventListener('message', handler)
        resolve(m.result?.result?.value ?? '')
      }
    }
    ws.addEventListener('message', handler)
    ws.send(JSON.stringify({ id: my, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true } }))
  })
}
console.log('PUSH', await ev(`window.dshw.syncPush().then(r => JSON.stringify(r))`))
console.log('PULL', await ev(`window.dshw.syncPull().then(r => JSON.stringify(r))`))
console.log('CFG', await ev(`window.dshw.getSyncConfig().then(r => JSON.stringify({ counts: r.counts, lastSyncAt: r.config.lastSyncAt }))`))
ws.close()
process.exit(0)
