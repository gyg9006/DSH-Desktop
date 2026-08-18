/**
 * v2.1.3 服务启动验证：点击底部"启动服务" → 验证 dsh 服务用内置环境成功启动。
 * 用法：node scripts/cdp-v213-start-svc.mjs [port]
 */
const port = process.argv[2] ?? '9223'
const list = await fetch(`http://127.0.0.1:${port}/json`).then((r) => r.json())
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
function ev(expression, timeout = 10000) {
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

// 点击"启动服务"按钮（主界面底部状态栏）
const click = await ev(`(() => {
  const btns = [...document.querySelectorAll('button')]
  const btn = btns.find(b => b.innerText.includes('启动服务'))
  if (!btn) return 'NO_START_BTN: ' + btns.map(b=>b.innerText.trim().slice(0,15)).join('|')
  btn.click()
  return 'CLICKED_START'
})()`)
console.log('START:', click)

// 轮询服务状态（最多 90s：内置 node 启动 dsh web）
let status = ''
for (let i = 0; i < 18; i++) {
  await new Promise((r) => setTimeout(r, 5000))
  const st = await ev(`document.body.innerText.slice(-300)`)
  const isRunning = typeof st === 'string' && (st.includes('服务运行中') || st.includes('运行中') || st.includes('启动服务成功'))
  const isStopped = typeof st === 'string' && (st.includes('服务未启动') || st.includes('已停止'))
  console.log(`poll#${i + 1} running=${isRunning} stopped=${isStopped} tail=${typeof st === 'string' ? st.split(String.fromCharCode(10)).filter(Boolean).slice(-4).join(' / ') : st}`)
  if (isRunning) {
    status = 'RUNNING'
    break
  }
  if (isStopped && i > 2) break
}
console.log('FINAL:', status || 'UNKNOWN')
ws.close()
process.exit(0)
