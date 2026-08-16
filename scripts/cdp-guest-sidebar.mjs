/** 启动服务并打开对话，检查 dsh web 侧边栏 DOM 结构（用于 CSS 隐藏）。 */
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
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const g = (expr, timeout = 15000) => ev(`(async () => { const wv = document.querySelector('webview'); return String(await wv.executeJavaScript(${JSON.stringify(expr)}, true, ${timeout})) })()`, timeout + 3000)

// 启动服务
await ev(`(() => { const btn = [...document.querySelectorAll('aside button')].find(b => b.innerText.includes('启动')); if (!btn) return 'NO'; btn.click(); return 'ok' })()`)
let status = ''
for (let i = 0; i < 60; i++) {
  await wait(2500)
  status = await ev(`(() => { const d = [...document.querySelectorAll('.status-dot')].find(x => x.closest('aside')); return d ? d.className.replace('status-dot status-dot--', '') : 'none'; })()`)
  if (status === 'running') break
}
console.log('服务状态:', status)
if (status !== 'running') process.exit(1)

// 打开对话 → webview
await ev(`(() => { const btn = [...document.querySelectorAll('aside button')].find(b => b.innerText.includes('开始对话')); if (!btn) return 'NO'; btn.click(); return 'ok' })()`)
await wait(10000)

// 侧边栏 DOM 结构：新建会话按钮的祖先链
const chain = await g(`(() => {
  const btn = [...document.querySelectorAll('button')].find(b => (b.getAttribute('aria-label') || '') === '新建会话')
  if (!btn) return 'NO_BTN'
  const out = []
  let el = btn
  for (let i = 0; i < 8 && el; i++) {
    const r = el.getBoundingClientRect()
    out.push({ i, tag: el.tagName, cls: (el.className || '').toString().slice(0, 60), w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.x), y: Math.round(r.y), role: el.getAttribute('role') || '', data: Object.keys(el.dataset || {}).join(',') })
    el = el.parentElement
  }
  return JSON.stringify(out)
})()`)
console.log('新建会话按钮祖先链:', chain)

// 侧边栏整体：找包含「打开侧边栏」「新建会话」「搜索会话」的最小共同祖先
const rail = await g(`(() => {
  const labels = ['打开侧边栏', '新建会话', '添加工作区', '搜索会话']
  const btns = labels.map(l => [...document.querySelectorAll('button')].find(b => (b.getAttribute('aria-label') || b.innerText || '').trim() === l)).filter(Boolean)
  if (btns.length < 3) return 'NOT_ENOUGH ' + btns.length
  let common = btns[0]
  for (const b of btns) {
    while (common && !common.contains(b)) common = common.parentElement
  }
  if (!common) return 'NO_COMMON'
  const r = common.getBoundingClientRect()
  return JSON.stringify({ tag: common.tagName, cls: (common.className || '').toString().slice(0, 80), w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.x), y: Math.round(r.y), tagName: common.tagName })
})()`)
console.log('侧边栏共同祖先:', rail)

// 侧边栏展开时宽度与布局容器
const layout = await g(`(() => {
  // 顶层直接子元素
  const kids = [...document.querySelector('body > div, #root, body').children].map(el => { const r = el.getBoundingClientRect(); return { tag: el.tagName, cls: (el.className || '').toString().slice(0, 50), x: Math.round(r.x), w: Math.round(r.width) } })
  return JSON.stringify(kids)
})()`)
console.log('顶层布局:', layout)
ws.close()
process.exit(0)
