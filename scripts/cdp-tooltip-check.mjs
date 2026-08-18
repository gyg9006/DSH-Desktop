/** T15/T16 Tooltip hover 验证。 */
const port = process.argv[2] ?? '9229'
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
// 鼠标悬停"自动探测"（React 合成事件走 mouseover/mouseout）→ 等 400ms → 检查 tooltip 文案
const hover = await ev(`(async () => {
  const find = (txt) => [...document.querySelectorAll('span, div, button')].find(e => e.children.length === 0 && e.textContent.trim() === txt)
  const auto = find('自动探测')
  if (!auto) return 'NO_AUTO'
  auto.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
  await new Promise(r => setTimeout(r, 450))
  const shown = document.body.innerText.includes('自动寻找可用端口')
  auto.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }))
  await new Promise(r => setTimeout(r, 350))
  const gone = !document.body.innerText.includes('自动寻找可用端口')
  const fixed = find('固定端口')
  fixed.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
  await new Promise(r => setTimeout(r, 450))
  const shown2 = document.body.innerText.includes('手动指定端口号')
  return JSON.stringify({ autoShown: shown, autoGoneAfterLeave: gone, fixedShown: shown2 })
})()`)
console.log('T15/T16 Tooltip hover:', hover)
ws.close()
process.exit(0)
