/** 诊断：发送消息后转储 guest 全文，观察实际状态。 */
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
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const clickByText = (text) =>
  ev(`(() => { const btn = [...document.querySelectorAll('button')].find(b => b.innerText.trim().includes(${JSON.stringify(text)})); if (!btn || btn.disabled) return 'NOT_FOUND'; btn.click(); return 'clicked'; })()`)

// 启动服务
await clickByText('一键启动服务')
for (let i = 0; i < 60; i++) {
  await wait(3000)
  const st = await ev(`(() => { const d = [...document.querySelectorAll('.status-dot')].find(x => x.closest('aside')); return d ? d.className.replace('status-dot status-dot--', '') : 'none'; })()`)
  if (st === 'running') break
}
await wait(6000)

// 发送
await ev(`(async () => {
  const wv = document.querySelector('webview');
  await wv.executeJavaScript(\`(async () => {
    const ta = [...document.querySelectorAll('textarea')].find(el => { const r = el.getBoundingClientRect(); return r.width > 200 && r.height > 40; });
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
    setter.call(ta, '你好');
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(r => setTimeout(r, 300));
    const sendBtn = [...document.querySelectorAll('button')].find(b => { const r = b.getBoundingClientRect(); return r.width > 20 && r.width < 60 && r.height > 20 && r.height < 60; });
    if (sendBtn) sendBtn.click();
    return 'ok';
  })()\`);
  return 'done';
})()`)

// 等待并转储
await wait(25000)
const dump = await ev(`(async () => {
  const wv = document.querySelector('webview');
  const text = String(await wv.executeJavaScript('document.body.innerText'));
  return text;
})()`, 12000)
console.log('=== GUEST 全文（发送后） ===')
console.log(JSON.stringify(dump).slice(0, 1500))
ws.close()
process.exit(0)
