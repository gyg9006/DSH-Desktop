/** 验证 #2：webview 内 dsh 侧边栏默认隐藏 + 桌面工具条开关可显示/隐藏。 */
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

// 启动服务
await ev(`(() => { const btn = [...document.querySelectorAll('aside button')].find(b => b.innerText.includes('启动')); if (!btn) return 'NO'; btn.click(); return 'ok' })()`)
let status = ''
for (let i = 0; i < 60; i++) {
  await wait(2500)
  status = await ev(`(() => { const d = [...document.querySelectorAll('.status-dot')].find(x => x.closest('aside')); return d ? d.className.replace('status-dot status-dot--', '') : 'none'; })()`)
  if (status === 'running') break
}
console.log('服务状态:', status)

// 打开对话
await ev(`(() => { const btn = [...document.querySelectorAll('aside button')].find(b => b.innerText.includes('开始对话')); if (!btn) return 'NO'; btn.click(); return 'ok' })()`)
await wait(12000)

// 检查 guest 侧边栏是否隐藏（默认 showDshSidebar=false）
const hiddenState = await g(`(() => {
  const nav = [...document.querySelectorAll('button')].find(b => (b.getAttribute('aria-label') || '').includes('新建会话'))
  if (!nav) return JSON.stringify({ helper: window.__dshwSidebarHelper ? 'yes' : 'no', nav: false })
  let el = nav
  while (el) {
    const cls = typeof el.className === 'string' ? el.className : ''
    if (cls.includes('_root') && el.getBoundingClientRect().width < 150) {
      return JSON.stringify({ helper: window.__dshwSidebarHelper ? 'yes' : 'no', display: el.style.display, width: Math.round(el.getBoundingClientRect().width) })
    }
    el = el.parentElement
  }
  return JSON.stringify({ helper: window.__dshwSidebarHelper ? 'yes' : 'no', nav: true, root: 'none' })
})()`)
console.log('guest 侧边栏默认状态:', hiddenState)
const hs = JSON.parse(hiddenState)
const checks = []
const check = (n, ok, d = '') => { checks.push([n, ok, d]); console.log(`${ok ? '✓' : '✗'} ${n}${d ? '  ' + d : ''}`) }
check('#2 侧边栏助手已注入', hs.helper === 'yes')
check('#2 默认隐藏（display:none）', hs.display === 'none', JSON.stringify(hs))

// 点桌面工具条「☰」→ 显示
await ev(`(() => { const btn = document.querySelector('button[aria-label="显示或隐藏 dsh 侧边栏"]'); if (!btn) return 'NO_BTN'; btn.click(); return 'ok' })()`)
await wait(800)
const shown = await g(`(() => { const nav = [...document.querySelectorAll('button')].find(b => (b.getAttribute('aria-label') || '').includes('新建会话')); if (!nav) return 'NO_NAV'; let el = nav; while (el) { const cls = typeof el.className === 'string' ? el.className : ''; if (cls.includes('_root') && el.getBoundingClientRect().width < 150) return el.style.display === '' ? 'visible' : el.style.display; el = el.parentElement } return 'NO_ROOT' })()`)
check('#2 工具条开关 → 显示侧边栏', shown === 'visible', shown)

// 再点 → 隐藏
await ev(`(() => { const btn = document.querySelector('button[aria-label="显示或隐藏 dsh 侧边栏"]'); if (!btn) return 'NO'; btn.click(); return 'ok' })()`)
await wait(800)
const hidden2 = await g(`(() => { const nav = [...document.querySelectorAll('button')].find(b => (b.getAttribute('aria-label') || '').includes('新建会话')); if (!nav) return 'NO_NAV'; let el = nav; while (el) { const cls = typeof el.className === 'string' ? el.className : ''; if (cls.includes('_root') && el.getBoundingClientRect().width < 150) return el.style.display === 'none' ? 'hidden' : el.style.display; el = el.parentElement } return 'NO_ROOT' })()`)
check('#2 再点 → 重新隐藏', hidden2 === 'hidden', hidden2)
ws.close()
process.exit(0)
