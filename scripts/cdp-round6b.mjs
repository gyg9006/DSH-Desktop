/** 验证 #1 搜索无空白 + 排序提示 + #2 收起布局。 */
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
function ev(expression, timeout = 30000) {
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
const g = (expr, timeout = 30000) => ev(`(async () => { const wv = document.querySelector('webview'); return String(await wv.executeJavaScript(${JSON.stringify(expr)}, true, ${timeout})) })()`, timeout + 3000)
const check = (n, ok, d = '') => console.log(`${ok ? '✓' : '✗'} ${n}${d ? '  ' + d : ''}`)

// 回会话视图
await ev(`(() => { const b = [...document.querySelectorAll('aside button')].find(x => x.innerText.includes('返回会话')); if (b) b.click(); return 'ok' })()`)
await wait(800)

// #1 搜索：点击后出现桌面搜索框（不触发 guest）
await ev(`(() => { const b = document.querySelector('aside button[aria-label="搜索会话"]'); if (!b) return 'NO'; b.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); return 'ok' })()`)
await wait(600)
const searchBox = await ev(`(() => {
  const aside = document.querySelector('aside')
  const inputs = [...aside.querySelectorAll('input')].filter(i => i.placeholder && i.placeholder.includes('搜索会话标题'))
  return JSON.stringify({ hasDesktopSearch: inputs.length > 0, webview: !!document.querySelector('webview') })
})()`)
check('#1 搜索为桌面搜索框（不弹空白侧边栏）', JSON.parse(searchBox).hasDesktopSearch === true, searchBox)
// 搜索过滤生效（输入不存在的词 → 会话隐藏）
await ev(`(() => { const i = [...document.querySelectorAll('aside input')].find(x => x.placeholder && x.placeholder.includes('搜索会话标题')); if (i) { const s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set; s.call(i, '不存在的会话xyz'); i.dispatchEvent(new Event('input', { bubbles: true })); } return 'ok' })()`)
await wait(500)
const filtered = await ev(`(() => { const aside = document.querySelector('aside'); const rows = [...aside.querySelectorAll('div')].filter(d => d.innerText.includes('session-') && d.innerText.length < 60); return JSON.stringify({ visibleSessions: rows.length }) })()`)
check('#1 搜索过滤生效', JSON.parse(filtered).visibleSessions === 0, filtered)
await ev(`(() => { const i = [...document.querySelectorAll('aside input')].find(x => x.placeholder && x.placeholder.includes('搜索会话标题')); if (i) { const s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set; s.call(i, ''); i.dispatchEvent(new Event('input', { bubbles: true })); } return 'ok' })()`)
await wait(400)

// #1 视图选项按钮有 tooltip
const hasTip = await ev(`(() => { const b = document.querySelector('aside button[aria-label="视图选项"]'); if (!b) return false; return !!b.closest('.el-tooltip') || !!document.querySelector('.el-popper') })()`)
check('#1 视图选项按钮 tooltip 存在', hasTip === true, String(hasTip))

// #2 启动服务 + 打开对话，测量收起布局
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

const layoutExpanded = await ev(`(async () => {
  const wv = document.querySelector('webview')
  const wr = wv.getBoundingClientRect()
  const gx = await wv.executeJavaScript('(() => { const el = document.querySelector(\'[class*="sidebarCol"]\') || document.querySelector(\'body > div > div > div\'); const r = el ? el.getBoundingClientRect() : null; return r ? JSON.stringify({ x: Math.round(r.x), w: Math.round(r.width) }) : \'none\' })()')
  return JSON.stringify({ wvX: Math.round(wr.x), wvW: Math.round(wr.width), guest: gx, winW: window.innerWidth })
})()`)
console.log('展开态布局:', layoutExpanded)
await ev(`(() => { const b = document.querySelector('aside button[aria-label="收起或展开任务栏"]'); if (b) b.click(); return 'ok' })()`)
await wait(1200)
const layoutCollapsed = await ev(`(async () => {
  const wv = document.querySelector('webview')
  const wr = wv.getBoundingClientRect()
  const gx = await wv.executeJavaScript('(() => { const main = [...document.querySelectorAll(\'div\')].find(d => { const r = d.getBoundingClientRect(); return r.width > 900 && r.x < 100 && r.height > 400 }); const r = main ? main.getBoundingClientRect() : null; return r ? JSON.stringify({ x: Math.round(r.x), w: Math.round(r.width), right: Math.round(r.right) }) : \'none\' })()')
  return JSON.stringify({ wvX: Math.round(wr.x), wvW: Math.round(wr.width), guest: gx, winW: window.innerWidth })
})()`)
console.log('收起态布局:', layoutCollapsed)
const le = JSON.parse(layoutExpanded)
const lc = JSON.parse(layoutCollapsed)
check('#2 收起后 webview 扩展', lc.wvW > le.wvW && lc.wvX <= le.wvX, `expanded=${le.wvW} collapsed=${lc.wvW}`)
ws.close()
process.exit(0)
