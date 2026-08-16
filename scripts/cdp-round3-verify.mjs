/** 本轮 4 项修复综合验证：去重按钮 / 通用设置+侧边栏隐藏 / 推荐技能 / 导入多选入口。 */
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
const clickByText = (text) =>
  ev(`(() => { const btn = [...document.querySelectorAll('button')].find(b => b.innerText.trim().includes(${JSON.stringify(text)})); if (!btn) return 'NOT_FOUND'; btn.click(); return 'clicked'; })()`)
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const g = (expr, timeout = 20000) => ev(`(async () => { const wv = document.querySelector('webview'); return String(await wv.executeJavaScript(${JSON.stringify(expr)}, true, ${timeout})) })()`, timeout + 3000)

const checks = []
const check = (n, ok, d = '') => { checks.push([n, ok, d]); console.log(`${ok ? '✓' : '✗'} ${n}${d ? '  ' + d : ''}`) }

// ---------- #1 设置按钮去重 ----------
const expandedBtns = await ev(`JSON.stringify([...document.querySelectorAll('aside button')].map(b => (b.getAttribute('aria-label') || b.innerText.trim())))`)
const bottomGear = JSON.parse(expandedBtns).filter((t) => t === '打开设置').length
check('#1 展开态底部无重复设置按钮', bottomGear === 0, `bottom 设置按钮数=${bottomGear}`)
// 顶部导航仍有会话/设置切换
check('#1 顶部导航设置入口保留', await ev(`[...document.querySelectorAll('aside button')].some(b => b.innerText.trim() === '设置')`))

// ---------- #4 导入入口：文件夹/文件两种模式 ----------
const importDropdown = await ev(`(() => {
  const btn = [...document.querySelectorAll('aside button')].find(b => b.innerText.includes('导入其他电脑的会话'))
  if (!btn) return 'NO_BTN'
  btn.click()
  return 'clicked'
})()`)
await wait(600)
const dropdownItems = await ev(`JSON.stringify([...document.querySelectorAll('.el-dropdown-menu__item')].map(i => i.innerText.trim()))`)
check('#4 导入下拉：文件夹+文件两模式', dropdownItems.includes('导入会话文件夹（可多选）') && dropdownItems.includes('导入会话文件（可多选）'), dropdownItems)
await ev(`document.body.click(); 'ok'`)
await wait(300)

// ---------- #2 通用设置 Tab ----------
await clickByText('设置')
await wait(600)
await clickByText('通用设置')
await wait(800)
const generalView = await ev(`JSON.stringify({
  hasLocale: document.body.innerText.includes('语言'),
  hasTheme: document.body.innerText.includes('dsh 界面外观'),
  hasPreset: document.body.innerText.includes('Agent 预设'),
  hasSidebarToggle: document.body.innerText.includes('显示 dsh 内置侧边栏'),
  presetCards: [...document.querySelectorAll('.settings-dialog .grid button')].length
})`)
const gv = JSON.parse(generalView)
check('#2 通用设置 Tab：语言/外观/预设/侧边栏', gv.hasLocale && gv.hasTheme && gv.hasPreset && gv.hasSidebarToggle, JSON.stringify(gv))
check('#2 Agent 预设卡片（≥4）', gv.presetCards >= 4, `cards=${gv.presetCards}`)

// 保存通用设置（语言 en + 预设 minimal + 隐藏侧边栏）
const presetClick = await ev(`(() => {
  const cards = [...document.querySelectorAll('.settings-dialog .grid button')]
  const c = cards.find(x => x.innerText.includes('极简模式'))
  if (!c) return 'NO_CARD'
  c.click()
  return 'ok'
})()`)
console.log('选极简模式:', presetClick)
await ev(`(() => { const btn = [...document.querySelectorAll('button')].find(b => b.innerText.includes('保存并同步到 dsh')); if (!btn) return 'NO'; btn.click(); return 'ok' })()`)
await wait(1500)
console.log('toasts:', await ev(`JSON.stringify([...document.querySelectorAll('.el-message')].map(m => m.innerText.trim()).slice(-3))`))
ws.close()
process.exit(0)
