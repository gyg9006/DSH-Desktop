/** 诊断：读取设置页环境检测每行的状态灯与文案。 */
const list = await fetch('http://127.0.0.1:9222/json').then((r) => r.json())
const page = list.find((t) => t.type === 'page' && t.url.includes('index.html'))
if (!page) throw new Error('未找到应用页面')
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((resolve, reject) => {
  ws.onopen = resolve
  ws.onerror = () => reject(new Error('ws error'))
})
let id = 0
function ev(expression) {
  return new Promise((resolve) => {
    const my = ++id
    const handler = (e) => {
      const m = JSON.parse(e.data)
      if (m.id === my) {
        ws.removeEventListener('message', handler)
        resolve(m.result?.result?.value ?? JSON.stringify(m.result?.exceptionDetails ?? ''))
      }
    }
    ws.addEventListener('message', handler)
    ws.send(JSON.stringify({ id: my, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true } }))
  })
}

// 打开设置（展开态 [2]=设置）
await ev(`(document.querySelectorAll('aside button')[2]).click(); 'ok'`)
await new Promise((r) => setTimeout(r, 800))
// 读取每行的状态：行 = .settings-dialog 中带 status-dot 的容器
const rows = await ev(`JSON.stringify([...document.querySelectorAll('.settings-dialog .status-dot')].map(dot => {
  const row = dot.closest('div.flex.items-center');
  return { dot: dot.className.replace('status-dot ', ''), text: row?.innerText?.replace(/\\s+/g, ' ').trim() ?? '' };
}))`)
console.log('ENV_ROWS:', rows)
ws.close()
process.exit(0)
