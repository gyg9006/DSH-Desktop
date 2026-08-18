/** M7 错误态验证（阶段2）：等待探活翻红 → 点击重试 → 恢复运行。 */
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
const clickByText = (text) =>
  ev(`(() => { const btn = [...document.querySelectorAll('button')].find(b => b.innerText.trim().includes(${JSON.stringify(text)})); if (!btn || btn.disabled) return 'NOT_FOUND'; btn.click(); return 'clicked'; })()`)
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const statusDot = () =>
  ev(`(() => { const d = [...document.querySelectorAll('.status-dot')].find(x => x.closest('aside')); return d ? d.className.replace('status-dot status-dot--', '') : 'none'; })()`)

// 1. 等待探活翻红（error）
let flipped = false
for (let i = 0; i < 24; i++) {
  await wait(5000)
  const st = await statusDot()
  console.log(`[${(i + 1) * 5}s] status=${st}`)
  if (st === 'error') {
    flipped = true
    break
  }
}
if (!flipped) {
  console.log('ERROR_STATE_FAIL: 未翻红')
  process.exit(1)
}
console.log('错误态:', await ev(`JSON.stringify({ errorPage: document.body.innerText.includes('服务异常'), retryBtn: [...document.querySelectorAll('button')].some(b => b.innerText.includes('重试')) })`))

// 2. 点击重试 → 恢复运行
console.log('重试:', await clickByText('重试'))
let recovered = false
for (let i = 0; i < 60; i++) {
  await wait(3000)
  const st = await statusDot()
  if (st === 'running') {
    recovered = true
    console.log(`恢复运行（${(i + 1) * 3}s）`)
    break
  }
}
ws.close()
console.log(recovered ? 'ERROR_RECOVERY_OK' : 'ERROR_RECOVERY_FAIL')
process.exit(recovered ? 0 : 1)
