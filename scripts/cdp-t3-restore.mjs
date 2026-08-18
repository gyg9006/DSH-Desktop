/** 恢复 Key 并检查 T3（二次启动直接主页）。 */
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
console.log('SAVE:', await ev(`window.dshw.modelsKeySave('deepseek', 'sk-test-abcdef1234567890').then(r => JSON.stringify(r)).catch(e => 'ERR ' + String(e))`))
console.log('T3 wizard(应为false=直接主页):', await ev(`document.body.innerText.includes('首次启动引导')`))
console.log('T3 nav:', await ev(`JSON.stringify([...document.querySelectorAll('button')].map(b => b.innerText.trim().slice(0, 8)).filter(Boolean).slice(0, 7))`))
ws.close()
process.exit(0)
