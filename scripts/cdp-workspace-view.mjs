/** 检查 dsh 工作区主视图的按钮/功能（新建会话/添加工作区/搜索/视图选项）。 */
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
function ev(expression, timeout = 20000) {
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
const g = (expr, timeout = 20000) => ev(`(async () => { const wv = document.querySelector('webview'); return String(await wv.executeJavaScript(${JSON.stringify(expr)}, true, ${timeout})) })()`, timeout + 3000)

// 启动服务并打开对话
await ev(`(() => { const btn = [...document.querySelectorAll('aside button')].find(b => b.innerText.includes('启动')); if (!btn) return 'NO'; btn.click(); return 'ok' })()`)
let status = ''
for (let i = 0; i < 60; i++) {
  await wait(2500)
  status = await ev(`(() => { const d = [...document.querySelectorAll('.status-dot')].find(x => x.closest('aside')); return d ? d.className.replace('status-dot status-dot--', '') : 'none'; })()`)
  if (status === 'running') break
}
console.log('服务:', status)
await ev(`(() => { const btn = [...document.querySelectorAll('aside button')].find(b => b.innerText.includes('开始对话')); if (!btn) return 'NO'; btn.click(); return 'ok' })()`)
await wait(12000)

// 工作区主视图按钮/元素
console.log('主视图按钮:', await g(`JSON.stringify([...document.querySelectorAll('button, [role=button], [role=tab], a')].map(b => { const t = (b.innerText||'').trim().replace(/\n/g,' '); const a = (b.getAttribute('aria-label')||'').trim(); return (t || a).slice(0, 40) }).filter(Boolean).slice(0, 60))`))
// 搜索框/视图选项
console.log('输入框:', await g(`JSON.stringify([...document.querySelectorAll('input')].map(i => ({ ph: i.placeholder || '', label: i.getAttribute('aria-label') || '' })).slice(0, 10))`))
console.log('含视图文本:', await g(`JSON.stringify([...document.querySelectorAll('*')].filter(el => (el.innerText||'').trim().length < 12 && /视图|排序|列表|分组|时间/.test((el.innerText||'').trim())).map(el => (el.innerText||'').trim()).slice(0, 20))`))
ws.close()
process.exit(0)
