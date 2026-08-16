/** 发送消息后长轮询等待助手回复。 */
const DEBUG_PORT = 9222
const list = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json`).then((r) => r.json())
const page = list.find((t) => t.type === 'page' && t.url.includes('index.html'))
if (!page) throw new Error('未找到应用页面')
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
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

let lastLen = 0
let replyFound = false
for (let i = 0; i < 30; i++) {
  await wait(10000)
  const guest = await ev(`(async () => {
    const wv = document.querySelector('webview');
    const text = String(await wv.executeJavaScript('document.body.innerText'));
    return text;
  })()`, 12000)
  const len = guest.length
  console.log(`[${(i + 1) * 10}s] 长度=${len} 增量=${len - lastLen}`)
  // 回复特征：出现"你好"的应答或错误提示
  if (/你好[！!。.]?(我是|，我|，可|！我)/.test(guest) || guest.includes('我是 DeepSeek') || guest.includes('无法') || guest.includes('错误')) {
    replyFound = true
    console.log('=== 回复内容 ===')
    console.log(guest.slice(-1200))
    break
  }
  lastLen = len
}
if (!replyFound) {
  console.log('NO_REPLY_YET 最后内容:')
  const guest = await ev(`(async () => { const wv = document.querySelector('webview'); return String(await wv.executeJavaScript('document.body.innerText')); })()`, 12000)
  console.log(guest.slice(-1200))
}
ws.close()
process.exit(replyFound ? 0 : 2)
