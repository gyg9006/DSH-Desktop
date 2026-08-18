/** 检查当前路由 + 设置导航结构。 */
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
console.log('HASH:', await ev('location.hash'))
// 列出所有按钮文本
console.log('BUTTONS:', await ev(`JSON.stringify([...document.querySelectorAll('button')].map(b => b.innerText.trim()).filter(Boolean).slice(0, 40))`))
// 点击包含"设置"的按钮（Sidebar 导航）
console.log('NAV:', await ev(`(() => { const b = [...document.querySelectorAll('button')].find(x => x.innerText.trim() === '设置'); if (!b) return 'NO_BTN'; b.click(); return 'OK' })()`))
await new Promise((r) => setTimeout(r, 1500))
console.log('AFTER_HASH:', await ev('location.hash'))
console.log('AFTER_BTNS:', await ev(`JSON.stringify([...document.querySelectorAll('button')].map(b => b.innerText.trim()).filter(Boolean).slice(0, 50))`))
console.log('BODY_TAIL:', await ev('document.body.innerText.slice(0, 400)'))
ws.close()
process.exit(0)
