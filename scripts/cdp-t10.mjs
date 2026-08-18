/** T10 删除 Key → 凭据清空（dsh 将弹配置引导）。 */
const port = process.argv[2] ?? '9229'
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
console.log('T10 删除 Key:', await ev(`window.dshw.modelsKeyDelete('deepseek').then(r => JSON.stringify(r)).catch(e => 'ERR')`))
await new Promise((r) => setTimeout(r, 1500))
const masks = await ev(`window.dshw.modelsGet().then(v => JSON.stringify(Object.keys(v.keyMasks))).catch(e => 'ERR')`)
console.log('T10 删除后 keyMasks:', masks)
ws.close()
process.exit(0)
