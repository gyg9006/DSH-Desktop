/** M6 便携性验收：副本启动 → 向导 → 会话 → 服务 → webview → 尝试真实对话。 */
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
const clickByText = (text) =>
  ev(`(() => { const btn = [...document.querySelectorAll('button')].find(b => b.innerText.trim().includes(${JSON.stringify(text)})); if (!btn || btn.disabled) return 'NOT_FOUND_OR_DISABLED'; btn.click(); return 'clicked'; })()`)
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

// 1. 向导应出现（副本首次运行）
console.log('向导:', await ev(`document.querySelector('.el-step') ? '显示' : '缺失'`))
console.log('路径:', await ev(`(() => { const m = document.body.innerText.match(/D:\\\\[^\\n]{0,60}workspace/); return m ? m[0] : 'N/A'; })()`))

// 2. 完成向导
await clickByText('下一步')
await wait(800)
await clickByText('跳过')
await wait(800)
await clickByText('完成，开始使用')
await wait(1500)

// 3. 会话列表（复制来的数据）
console.log('会话:', await ev(`JSON.stringify({ count: document.querySelectorAll('aside .group').length, first: document.querySelector('aside .group .text-xs.font-medium')?.innerText?.slice(0, 30) ?? 'N/A' })`))

// 4. 启动服务
console.log('启动:', await clickByText('一键启动服务'))
let running = false
for (let i = 0; i < 60; i++) {
  await wait(3000)
  const st = await ev(`(() => { const d = [...document.querySelectorAll('.status-dot')].find(x => x.closest('aside')); return d ? d.className.replace('status-dot status-dot--', '') : 'none'; })()`)
  if (st === 'running') {
    running = true
    console.log(`服务运行中（${(i + 1) * 3}s）`)
    break
  }
  if (st === 'error') break
}
if (!running) {
  console.log('PORTABILITY_FAIL: 服务未运行')
  process.exit(1)
}

// 5. webview 加载
await wait(6000)
const guest = await ev(`(() => { const wv = document.querySelector('webview'); if (!wv?.executeJavaScript) return 'NO_WEBVIEW'; return wv.executeJavaScript('document.body.innerText.slice(0, 200)').then(t => String(t)).catch(e => 'ERR ' + e); })()`, 10000)
console.log('webview:', JSON.stringify(guest).slice(0, 160))

// 6. 尝试真实对话：找输入框并发送消息
const chatResult = await ev(`(async () => {
  const wv = document.querySelector('webview');
  if (!wv?.executeJavaScript) return 'NO_WEBVIEW';
  // 在 guest 中查找聊天输入框
  const probe = await wv.executeJavaScript(\`(() => {
    const candidates = [...document.querySelectorAll('textarea, [contenteditable="true"], input[type="text"]')]
      .filter(el => { const r = el.getBoundingClientRect(); return r.width > 100 && r.height > 20; });
    return JSON.stringify(candidates.map(el => ({ tag: el.tagName, cls: el.className.slice(0, 80), ph: el.placeholder || '', ce: el.isContentEditable })));
  })()\`);
  return 'INPUTS ' + String(probe);
})()`, 12000)
console.log('输入框探测:', chatResult.slice(0, 300))
ws.close()
process.exit(0)
