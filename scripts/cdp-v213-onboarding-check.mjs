/**
 * v2.1.3 引导页验证：跳过按钮 / 内置环境标签 / 点击跳过进入主界面。
 * 用法：node scripts/cdp-v213-onboarding-check.mjs [port]
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

const snapshot = await ev(`JSON.stringify({
  title: document.title,
  hasWizard: document.body.innerText.includes('首次启动引导'),
  bodyText: document.body.innerText.slice(0, 400),
  skipButtons: [...document.querySelectorAll('button')].filter(b => b.innerText.includes('跳过引导')).map(b => b.innerText.trim()),
  allButtons: [...document.querySelectorAll('button')].map(b => b.innerText.trim().slice(0, 20))
})`)
console.log('SNAPSHOT:', snapshot)

// 覆盖 window.confirm（避免原生同步对话框阻塞 CDP），然后点击"跳过引导"
const clickResult = await ev(`(() => {
  window.confirm = () => true
  const btn = [...document.querySelectorAll('button')].find(b => b.innerText.includes('跳过引导'))
  if (!btn) return 'NO_SKIP_BUTTON'
  btn.click()
  return 'CLICKED'
})()`)
console.log('CLICK:', clickResult)

// confirm 对话框处理：window.confirm 在 Electron 中默认同步返回（无原生对话框）。
// 若被拦截则需覆盖 confirm；先等待 1.5s 再看状态
await new Promise((r) => setTimeout(r, 2000))
const after = await ev(`JSON.stringify({
  hasWizard: document.body.innerText.includes('首次启动引导'),
  isMain: document.body.innerText.includes('工作台') || document.body.innerText.includes('会话') || document.body.innerText.includes('知识库'),
  bodyText: document.body.innerText.slice(0, 300)
})`)
console.log('AFTER:', after)
ws.close()
process.exit(0)
