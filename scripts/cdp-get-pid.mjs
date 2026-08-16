/** M7 错误态验证：杀掉 dsh 进程 → UI 探活翻红 → 重试恢复。 */
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

// 若在向导中则完成向导
const inWizard = await ev(`!!document.querySelector('.el-step')`)
if (inWizard) {
  await clickByText('下一步')
  await wait(800)
  await clickByText('跳过')
  await wait(800)
  await clickByText('完成，开始使用')
  await wait(1500)
}

// 启动服务
await clickByText('一键启动服务')
for (let i = 0; i < 60; i++) {
  await wait(3000)
  const st = await statusDot()
  if (st === 'running') {
    console.log(`服务运行中（${(i + 1) * 3}s）`)
    break
  }
}
// 记录服务 PID（供外部 kill）
console.log('PID:', await ev(`window.dshw.getServiceStatus().then(s => s.pid)`))
ws.close()
process.exit(0)
