/** M6 终极验证：在 webview 内发起真实对话并等待回复。 */
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

// 在 guest 中输入消息并发送
const sendResult = await ev(`(async () => {
  const wv = document.querySelector('webview');
  if (!wv?.executeJavaScript) return 'NO_WEBVIEW';
  const guest = wv.executeJavaScript(\`(async () => {
    const ta = [...document.querySelectorAll('textarea')].find(el => { const r = el.getBoundingClientRect(); return r.width > 200 && r.height > 40; });
    if (!ta) return 'NO_TEXTAREA';
    // React 受控组件：用原生 setter + input 事件
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
    setter.call(ta, '你好，请用一句话介绍你自己');
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(r => setTimeout(r, 300));
    // 找发送按钮（输入框附近的 button，含发送图标或无文字的圆形按钮）
    const sendBtn = [...document.querySelectorAll('button')].find(b => {
      const r = b.getBoundingClientRect();
      return r.width > 20 && r.width < 60 && r.height > 20 && r.height < 60;
    });
    if (!sendBtn) return 'NO_SEND_BTN';
    sendBtn.click();
    return 'SENT';
  })()\`);
  return String(await guest);
})()`, 15000)
console.log('发送:', sendResult)

// 等待回复（轮询 guest 中是否出现新的助手消息）
let reply = 'NO_REPLY'
for (let i = 0; i < 40; i++) {
  await wait(5000)
  const probe = await ev(`(async () => {
    const wv = document.querySelector('webview');
    const text = String(await wv.executeJavaScript('document.body.innerText'));
    return text;
  })()`, 12000)
  // 回复特征：出现"你好"的应答或新增内容；简单判定：body 包含"DeepSeek"或"模型"等助手特征或长度显著变化
  if (probe.includes('我是') || probe.includes('你好！') || probe.includes('你好，我是')) {
    reply = probe.slice(0, 300)
    break
  }
  if (probe.length > 600) {
    reply = probe.slice(0, 300)
    break
  }
}
console.log('回复:', JSON.stringify(reply))
ws.close()
process.exit(0)
