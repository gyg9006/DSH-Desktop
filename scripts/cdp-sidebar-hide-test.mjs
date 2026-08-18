/** 验证：结构性隐藏 dsh 侧边栏 + 恢复，检查内容区是否正常扩展。 */
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

// 注入隐藏/恢复函数
const inject = await g(`(() => {
  window.__dshwSidebar = {
    root: null,
    hide() { if (!this.root) return 'NO_ROOT'; this.root.style.display = 'none'; return 'hidden' },
    show() { if (!this.root) return 'NO_ROOT'; this.root.style.display = ''; return 'shown' }
  }
  const nav = [...document.querySelectorAll('button')].find(b => (b.getAttribute('aria-label') || '').includes('新建会话'))
  if (!nav) return 'NO_NAV'
  let el = nav
  while (el) {
    const cls = typeof el.className === 'string' ? el.className : ''
    if (cls.includes('_root') && el.getBoundingClientRect().width < 150) { window.__dshwSidebar.root = el; return 'root found: ' + cls.slice(0, 60) }
    el = el.parentElement
  }
  return 'NO_ROOT'
})()`)
console.log('注入:', inject)

const before = await g(`(() => { const wv = document; const content = [...document.querySelectorAll('div')].find(d => d.getBoundingClientRect().width > 600 && d.getBoundingClientRect().x > 60 && d.getBoundingClientRect().height > 400); const r = content ? content.getBoundingClientRect() : null; return JSON.stringify({ sidebarW: window.__dshwSidebar.root.getBoundingClientRect().width, contentW: r ? Math.round(r.width) : null, contentX: r ? Math.round(r.x) : null, bodyText: document.body.innerText.includes('新建会话') }) })()`)
console.log('隐藏前:', before)

console.log('hide:', await g(`window.__dshwSidebar.hide()`))
await wait(600)
const after = await g(`(() => { const content = [...document.querySelectorAll('div')].find(d => d.getBoundingClientRect().width > 600 && d.getBoundingClientRect().x >= 0 && d.getBoundingClientRect().height > 400); const r = content ? content.getBoundingClientRect() : null; return JSON.stringify({ contentW: r ? Math.round(r.width) : null, contentX: r ? Math.round(r.x) : null }) })()`)
console.log('隐藏后:', after)

console.log('show:', await g(`window.__dshwSidebar.show()`))
await wait(400)
console.log('恢复后 body 含新建会话:', await g(`document.body.innerText.includes('新建会话')`))
ws.close()
process.exit(0)
