/** 发送尝试 2：Enter 键 + 发送图标按钮定位。 */
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

// 输入并用 Enter 提交
const r = await ev(`(async () => {
  const wv = document.querySelector('webview');
  const out = await wv.executeJavaScript(\`(async () => {
    const ta = [...document.querySelectorAll('textarea')].find(el => { const r = el.getBoundingClientRect(); return r.width > 200 && r.height > 40; });
    if (!ta) return 'NO_TEXTAREA';
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
    setter.call(ta, '回复“你好”即可');
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(r => setTimeout(r, 400));
    // 先尝试 Enter
    ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true }));
    ta.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true }));
    await new Promise(r => setTimeout(r, 1500));
    // 检查输入是否已清空（发送成功标志）
    const cleared = ta.value.length === 0;
    return 'ENTER done, cleared=' + cleared;
  })()\`);
  return String(await out);
})()`, 15000)
console.log('Enter 提交:', r)

// 轮询回复
let replyFound = false
for (let i = 0; i < 36; i++) {
  await wait(10000)
  const guest = await ev(`(async () => { const wv = document.querySelector('webview'); return String(await wv.executeJavaScript('document.body.innerText')); })()`, 12000)
  const len = guest.length
  console.log(`[${(i + 1) * 10}s] 长度=${len}`)
  if (len > 400 || guest.includes('回复') || guest.includes('你好')) {
    if (len > 400) {
      replyFound = true
      console.log('=== 回复 ===')
      console.log(guest.slice(-1500))
      break
    }
  }
}
ws.close()
process.exit(replyFound ? 0 : 3)
