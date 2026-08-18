/** 验证 symlink 坏安装自动修复：startService → 自动重装 → 服务运行。 */
const port = process.argv[2] ?? '9228'
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
console.log('START:', await ev(`window.dshw.startService().then(r => JSON.stringify(r)).catch(e => "ERR " + String(e))`, 12000))
// 快速轮询（先看是否进入重装：runtime/dsh 被清）
for (let i = 0; i < 30; i++) {
  await new Promise((r) => setTimeout(r, 10000))
  const st = await ev('document.body.innerText.slice(-200)')
  const txt = typeof st === 'string' ? st : String(st)
  const isRun = txt.includes('服务运行中') || txt.includes('运行中 ·')
  console.log(`poll#${i + 1} run=${isRun} :: ${txt.split('\n').filter(Boolean).slice(-2).join(' | ')}`)
  if (isRun) break
}
ws.close()
process.exit(0)
