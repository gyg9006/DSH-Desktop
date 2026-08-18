/** 转储完整 guest 内容（含回复）。 */
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
function ev(expression, timeout = 12000) {
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
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const clickByText = (text) =>
  ev(`(() => { const btn = [...document.querySelectorAll('button')].find(b => b.innerText.trim().includes(${JSON.stringify(text)})); if (!btn || btn.disabled) return 'NOT_FOUND'; btn.click(); return 'clicked'; })()`)

await clickByText('一键启动服务')
for (let i = 0; i < 60; i++) {
  await wait(3000)
  const st = await ev(`(() => { const d = [...document.querySelectorAll('.status-dot')].find(x => x.closest('aside')); return d ? d.className.replace('status-dot status-dot--', '') : 'none'; })()`)
  if (st === 'running') break
}
await wait(8000)
const dump = await ev(`(async () => { const wv = document.querySelector('webview'); return String(await wv.executeJavaScript('document.body.innerText')); })()`)
console.log('=== GUEST 全文 ===')
console.log(dump.slice(0, 2500))
// 消息区域元素探测
const msgs = await ev(`(async () => {
  const wv = document.querySelector('webview');
  return String(await wv.executeJavaScript('JSON.stringify([...document.querySelectorAll(\"div[data-role], [class*=message], [class*=Message], [class*=bubble]\")].slice(0, 8).map(el => (el.className || el.getAttribute(\"data-role\") || \"\").toString().slice(0, 60)))'));
})()`)
console.log('=== 消息元素 ===')
console.log(msgs.slice(0, 800))
ws.close()
process.exit(0)
