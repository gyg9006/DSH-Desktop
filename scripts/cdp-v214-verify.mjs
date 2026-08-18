/** v2.1.4 验证：设置日志卡片 + 启动服务完整链路。 */
const port = process.argv[2] ?? '9225'
const list = await fetch(`http://127.0.0.1:${port}/json`).then((r) => r.json())
const page = list.find((t) => t.type === 'page' && t.url.includes('index.html'))
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((res, rej) => {
  ws.onopen = res
  ws.onerror = () => rej(new Error('ws'))
})
let id = 0
function ev(expression, to = 12000) {
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

// 1. 进入设置 → 高级（导航按钮文本"设置"）
const nav = await ev(`(() => { const b = [...document.querySelectorAll('button, [role="menuitem"], a')].find(x => x.innerText.trim() === '设置' || x.innerText.includes('设置')); if (!b) return 'NO_NAV'; b.click(); return 'NAV_CLICKED' })()`)
console.log('NAV:', nav)
await new Promise((r) => setTimeout(r, 1500))
// 找到"高级"子页并点击
const adv = await ev(`(() => { const b = [...document.querySelectorAll('button, [role="menuitem"], a, span')].find(x => x.innerText.trim() === '高级'); if (!b) return 'NO_ADV'; b.click(); return 'ADV_CLICKED' })()`)
console.log('ADV:', adv)
await new Promise((r) => setTimeout(r, 1500))
// 检查日志卡片
const logsCard = await ev(`JSON.stringify({
  hasLogsCard: document.body.innerText.includes('导出日志'),
  hasTerminal: document.body.innerText.includes('应用与服务运行日志'),
  hasEnv: document.body.innerText.includes('环境检测')
})`)
console.log('LOGSCARD:', logsCard)

// 2. 返回主界面点启动服务（日志卡片测试后，直接调 startService IPC 更可靠）
const start = await ev('window.dshw.startService().then(r => JSON.stringify(r)).catch(e => "ERR " + String(e))')
console.log('START_RET:', start)

// 3. 轮询服务状态（runtime 就绪，30s 内应就绪）
let final = 'UNKNOWN'
for (let i = 0; i < 12; i++) {
  await new Promise((r) => setTimeout(r, 5000))
  const st = await ev('document.body.innerText.slice(-300)')
  const txt = typeof st === 'string' ? st : String(st)
  const isRun = txt.includes('服务运行中') || txt.includes('运行中 ·') || txt.includes('dsh web 就绪')
  console.log(`poll#${i + 1} run=${isRun} :: ${txt.split('\n').filter(Boolean).slice(-3).join(' | ')}`)
  if (isRun) {
    final = 'RUNNING'
    break
  }
}
console.log('FINAL:', final)
ws.close()
process.exit(0)
