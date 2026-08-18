/** 导航到设置 → 高级，检查日志卡片。 */
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
// 点击设置（侧边栏底部）
console.log('click 设置:', await ev(`(() => { const els = [...document.querySelectorAll('*')].filter(e => e.children.length === 0 && e.textContent.trim() === '设置'); const el = els[0]; if (!el) return 'NO_设置'; el.click(); return 'OK' })()`))
await new Promise((r) => setTimeout(r, 1200))
// 点击"高级配置"子菜单
console.log('click 高级配置:', await ev(`(() => { const els = [...document.querySelectorAll('*')].filter(e => e.children.length === 0 && e.textContent.trim() === '高级配置'); const el = els[0]; if (!el) return 'NO_高级配置'; el.click(); return 'OK' })()`))
await new Promise((r) => setTimeout(r, 1500))
console.log('页面含日志卡片:', await ev(`JSON.stringify({
  exportLogs: document.body.innerText.includes('导出日志'),
  desc: document.body.innerText.includes('应用与服务运行日志'),
  clear: document.body.innerText.includes('清空'),
  envCard: document.body.innerText.includes('环境检测'),
  logText: (document.body.innerText.match(/\\[app\\]|[\\s\\S]{0,60}服务运行中/) || [''])[0].slice(0, 120)
})`))
ws.close()
process.exit(0)
