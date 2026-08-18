/** 正确导航到设置 → 高级配置，验证日志卡片。 */
const port = process.argv[2] ?? '9225'
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
console.log('NAV_设置:', await ev(`(() => { const b = [...document.querySelectorAll('button')].find(x => x.innerText.includes('设置') && x.innerText.includes('外观')); if (!b) return 'NO'; b.click(); return 'OK' })()`))
await new Promise((r) => setTimeout(r, 1500))
console.log('SET_BTNS:', await ev(`JSON.stringify([...document.querySelectorAll('button')].map(b => b.innerText.trim().slice(0, 12)).filter(Boolean).slice(0, 20))`))
console.log('NAV_高级配置:', await ev(`(() => { const b = [...document.querySelectorAll('button')].find(x => x.innerText.trim() === '高级配置'); if (!b) return 'NO'; b.click(); return 'OK' })()`))
await new Promise((r) => setTimeout(r, 1500))
console.log('LOGSCARD:', await ev(`JSON.stringify({
  exportLogs: document.body.innerText.includes('导出日志'),
  desc: document.body.innerText.includes('应用与服务运行日志'),
  envCard: document.body.innerText.includes('环境检测'),
  refresh: document.body.innerText.includes('刷新')
})`))
ws.close()
process.exit(0)
