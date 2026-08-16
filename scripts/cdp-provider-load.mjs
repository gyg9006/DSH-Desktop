/** 验证 dsh 是否接受桌面端同步的 llm-pi-ai 提供方：启动服务 → 打开对话 → 检查模型选择器/日志。 */
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
function ev(expression, timeout = 15000) {
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
  ev(`(() => { const btn = [...document.querySelectorAll('button')].find(b => b.innerText.trim().includes(${JSON.stringify(text)})); if (!btn || btn.disabled) return 'NOT_FOUND'; btn.click(); return 'clicked'; })()`)
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

// 关闭设置弹窗（若开着）
await ev(`(() => { const c = document.querySelector('.settings-dialog .el-dialog__headerbtn'); if (c) c.click(); return 'ok' })()`)
await wait(500)

// 启动服务
await ev(`(() => { const btn = [...document.querySelectorAll('aside button')].find(b => b.innerText.includes('启动')); if (!btn) return 'NO_BTN'; btn.click(); return 'started' })()`)
let status = ''
for (let i = 0; i < 60; i++) {
  await wait(2500)
  status = await ev(`(() => { const d = [...document.querySelectorAll('.status-dot')].find(x => x.closest('aside')); return d ? d.className.replace('status-dot status-dot--', '') : 'none'; })()`)
  if (status === 'running') break
}
console.log('服务状态:', status)

if (status === 'running') {
  // 打开对话 → webview
  await ev(`(() => { const btn = [...document.querySelectorAll('aside button')].find(b => b.innerText.includes('开始对话')); if (!btn) return 'NO_BTN'; btn.click(); return 'ok' })()`)
  await wait(12000)
  const wvInfo = await ev(`(() => { const wv = document.querySelector('webview'); return wv ? JSON.stringify({ url: wv.getURL(), hasDoc: wv.getWebContentsId ? true : false }) : 'NO_WEBVIEW' })()`)
  console.log('webview:', wvInfo)

  // 在 guest 中找模型选择器里的模型名
  const models = await ev(`(async () => {
    const wv = document.querySelector('webview')
    if (!wv) return 'NO_WEBVIEW'
    const text = String(await wv.executeJavaScript('document.body.innerText'))
    const hits = ['acme-large', 'acme-think', 'provider-1', 'Acme Gateway', 'DeepSeek'].filter(k => text.includes(k))
    return JSON.stringify({ hits, hasAcme: text.includes('acme-large') })
  })()`)
  console.log('guest 模型命中:', models)
}
ws.close()
process.exit(0)
