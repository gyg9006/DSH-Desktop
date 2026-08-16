/** 探查运行中应用的实际安装状态：DOM + 直接调用 runInstall IPC。 */
const list = await fetch('http://127.0.0.1:9222/json').then((r) => r.json())
const page = list.find((t) => t.type === 'page' && t.url.includes('index.html'))
if (!page) {
  console.log('NO_PAGE')
  process.exit(1)
}
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((resolve, reject) => {
  ws.onopen = resolve
  ws.onerror = () => reject(new Error('ws error'))
})

let id = 0
function ev(expression, timeout = 8000) {
  return new Promise((resolve) => {
    const my = ++id
    const timer = setTimeout(() => {
      ws.removeEventListener('message', handler)
      resolve('EVAL_TIMEOUT')
    }, timeout)
    const handler = (e) => {
      const m = JSON.parse(e.data)
      if (m.id === my) {
        clearTimeout(timer)
        ws.removeEventListener('message', handler)
        resolve(m.result?.result?.value ?? JSON.stringify(m.result?.exceptionDetails ?? ''))
      }
    }
    ws.addEventListener('message', handler)
    ws.send(JSON.stringify({ id: my, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true } }))
  })
}

console.log(
  'DOM:',
  await ev(`JSON.stringify({
    tags: [...document.querySelectorAll('.settings-dialog .el-tag')].map(t => t.innerText.trim()),
    logs: (document.querySelector('.settings-dialog pre')?.innerText ?? '').split('\\n').filter(Boolean).slice(-8)
  })`)
)
console.log(
  'direct npm:',
  await ev(
    `window.dshw.runInstall('npm','install').then(r => JSON.stringify(r)).catch(e => 'ERR ' + String(e))`,
    15000
  )
)
ws.close()
process.exit(0)
