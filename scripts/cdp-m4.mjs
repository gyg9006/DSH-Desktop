/** M4 端到端：向导完成 → 会话列表 → 一键启动 dsh 服务 → webview 加载 → 停止。 */
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

// 1. 完成向导
await clickByText('下一步')
await wait(800)
await clickByText('跳过')
await wait(800)
await clickByText('完成，开始使用')
await wait(1500)

// 2. 会话列表（应显示迁移的真实会话）
console.log('会话列表:', await ev(`JSON.stringify({
  count: document.querySelectorAll('aside .group').length,
  firstTitle: document.querySelector('aside .group .text-xs.font-medium')?.innerText?.slice(0, 40) ?? 'N/A',
  hasSearch: !!document.querySelector('aside input[placeholder*="搜索"]')
})`))

// 3. 一键启动服务（欢迎页）
console.log('启动:', await clickByText('一键启动服务'))

// 4. 轮询服务状态（侧栏状态点 + 文案）
let final = null
for (let i = 0; i < 60; i++) {
  await wait(3000)
  const state = await ev(`(() => {
    const dots = [...document.querySelectorAll('.status-dot')];
    const sidebarDot = dots.find(d => d.closest('aside'));
    const text = document.body.innerText;
    const status = sidebarDot ? sidebarDot.className.replace('status-dot status-dot--', '') : 'none';
    const hasWebview = !!document.querySelector('webview');
    const portMatch = text.match(/端口：(\d+)/);
    return JSON.stringify({ status, hasWebview, port: portMatch ? portMatch[1] : null });
  })()`)
  const parsed = JSON.parse(state)
  console.log(`[${(i + 1) * 3}s] status=${parsed.status} webview=${parsed.hasWebview} port=${parsed.port}`)
  if (parsed.status === 'running' && parsed.hasWebview) {
    final = parsed
    break
  }
  if (parsed.status === 'error') {
    final = parsed
    break
  }
}

// 5. webview 内容验证（executeJavaScript 进入 guest）
let guestTitle = 'N/A'
if (final?.status === 'running') {
  await wait(5000)
  guestTitle = await ev(`(() => { const wv = document.querySelector('webview'); if (!wv || !wv.executeJavaScript) return 'NO_WEBVIEW'; return wv.executeJavaScript('document.body.innerText.slice(0, 120) || document.title').then(t => String(t)).catch(e => 'GUEST_ERR ' + String(e)); })()`, 10000)
  console.log('webview 内容:', JSON.stringify(guestTitle).slice(0, 200))
}

// 6. 停止服务
console.log('停止:', await clickByText('停止'))
await wait(5000)
console.log('停止后:', await ev(`(() => { const d = [...document.querySelectorAll('.status-dot')].find(x => x.closest('aside')); return d ? d.className.replace('status-dot status-dot--', '') : 'none'; })()`))
ws.close()
if (final?.status !== 'running') {
  console.log('M4_E2E_FAIL status=' + (final?.status ?? 'timeout'))
  process.exit(1)
}
console.log('M4_E2E_OK guest=' + JSON.stringify(guestTitle).slice(0, 120))
process.exit(0)
