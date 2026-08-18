/** 测试矩阵 T3/T13/T14/T17。 */
const port = process.argv[2] ?? '9229'
const list = await fetch(`http://127.0.0.1:${port}/json`).then((r) => r.json())
const page = list.find((t) => t.type === 'page' && t.url.includes('index.html'))
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((res, rej) => {
  ws.onopen = res
  ws.onerror = () => rej(new Error('ws'))
})
let id = 0
function ev(expression, to = 20000) {
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
// T17 环境检测
const t17 = await ev(`window.dshw.detectEnv().then(x => JSON.stringify(x.items.map(i => i.key + ':' + i.source).join(','))).catch(e => 'ERR')`)
console.log('T17 环境检测:', t17)
// T13 停止服务
console.log('T13 停止服务:', await ev(`window.dshw.stopService().then(r => JSON.stringify(r)).catch(e => 'ERR')`))
await new Promise((r) => setTimeout(r, 4000))
const portAfter = await ev(`document.body.innerText.includes('已停止')`)
console.log('T13 停止后状态:', portAfter ? 'PASS(已停止)' : 'FAIL')
ws.close()
process.exit(0)
