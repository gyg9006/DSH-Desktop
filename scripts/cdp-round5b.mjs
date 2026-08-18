/** 本轮 4 项修复综合验证（修正选择器与导航顺序）。 */
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
const check = (n, ok, d = '') => console.log(`${ok ? '✓' : '✗'} ${n}${d ? '  ' + d : ''}`)

// 展开侧边栏（当前收起态）
const w0 = await ev(`document.querySelector('aside').getBoundingClientRect().width`)
if (w0 === 48) {
  await ev(`document.querySelector('aside button[aria-label="收起或展开任务栏"]').click(); 'ok'`)
  await wait(600)
}
await wait(1500)

// ---------- #1 工作区字样在左 + 视图选项 ----------
const rowInfo = await ev(`(() => {
  // 工作区操作行 = aside 内含「新建会话」「添加工作区」按钮且文本含「工作区」的容器
  const rows = [...document.querySelectorAll('aside div')].filter(d => d.innerText.includes('工作区') && [...d.querySelectorAll('button')].some(b => (b.getAttribute('aria-label') || '') === '新建会话'))
  if (!rows[0]) return 'NO_ROW'
  const text = rows[0].innerText.trim()
  const firstText = (rows[0].firstElementChild?.innerText || '').trim()
  return JSON.stringify({ text, firstText })
})()`)
const ri = JSON.parse(rowInfo)
check('#1 工作区字样在左（操作行首位）', ri.firstText === '工作区', rowInfo)

await ev(`(() => { const b = document.querySelector('aside button[aria-label="视图选项"]'); if (!b) return 'NO'; b.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); return 'ok' })()`)
await wait(800)
const viewMenu = await ev(`JSON.stringify([...document.querySelectorAll('.el-dropdown-menu__item')].map(i => i.innerText.trim()))`)
const vm = JSON.parse(viewMenu)
check('#1 视图选项与 dsh 一致（分组+排序）', ['分组方式', '按工作区', '单列表', '排序方式', '手动排序', '最近更新'].every(x => vm.includes(x)), viewMenu)

// ---------- #3 工作区树 ----------
const treeInfo = await ev(`(() => {
  const rows = [...document.querySelectorAll('aside div')].filter(d => [...d.querySelectorAll('button')].some(b => (b.getAttribute('aria-label') || '') === '工作区操作'))
  return JSON.stringify(rows.map(r => (r.innerText || '').trim().replace(/\n/g, ' / ')).slice(0, 4))
})()`)
const ti = JSON.parse(treeInfo)
check('#3 工作区树存在', ti.length >= 1, treeInfo)
// 展开第一个工作区（点击标题行）
await ev(`(() => { const btn = document.querySelector('aside button[aria-label="工作区操作"]'); if (!btn) return 'NO'; const row = btn.closest('div'); if (row) row.click(); return 'ok' })()`)
await wait(700)
const sessInfo = await ev(`(() => {
  const rows = [...document.querySelectorAll('aside div')].filter(d => d.querySelector('span') && d.innerText.includes('') && [...d.querySelectorAll('button')].length === 0 && d.querySelector('[class*=border-l]') === null)
  // 会话条目 = 含 ChatDotRound 图标 + 文本的行
  return JSON.stringify([...document.querySelectorAll('aside div')].filter(d => d.querySelector('svg') && (d.innerText || '').trim().length > 0 && d.innerText.trim().length < 60 && [...d.querySelectorAll('button')].length === 0).map(d => d.innerText.trim()).slice(0, 10))
})()`)
check('#3 展开后显示会话列表', JSON.parse(sessInfo).length >= 1, sessInfo)

// ---------- #2 插件分页 ----------
await ev(`(() => { const b = document.querySelector('aside button[aria-label="打开设置"]'); if (!b) return 'NO'; b.click(); return 'ok' })()`)
await wait(600)
await ev(`(() => { const b = [...document.querySelectorAll('aside button')].find(x => x.innerText.includes('插件')); if (b) b.click(); return 'ok' })()`)
await wait(1200)
const pluginCheck = await ev(`(() => {
  const pane = document.querySelector('.plugin-tabs .el-tab-pane[style*="display: block"], .plugin-tabs .el-tab-pane:not([style])')
  if (!pane) return 'NO_PANE'
  const cards = [...pane.querySelectorAll('.rounded-lg')].length
  const pager = pane.querySelector('.el-pagination')
  const pages = pager ? [...pager.querySelectorAll('.el-pager li')].length : 0
  return JSON.stringify({ cards, pages })
})()`)
const pc = JSON.parse(pluginCheck)
check('#2 推荐插件每页 10 个 + 分页 5 页', pc.cards === 10 && pc.pages === 5, pluginCheck)

await ev(`(() => { const t = [...document.querySelectorAll('.plugin-tabs .el-tabs__item')].find(x => x.innerText.includes('推荐技能')); if (t) t.click(); return 'ok' })()`)
await wait(1000)
const skillCheck = await ev(`(() => {
  const pane = [...document.querySelectorAll('.plugin-tabs .el-tab-pane')].find(p => p.offsetParent !== null)
  if (!pane) return 'NO_PANE'
  const cards = [...pane.querySelectorAll('.rounded-lg')].length
  const pager = pane.querySelector('.el-pagination')
  const pages = pager ? [...pager.querySelectorAll('.el-pager li')].length : 0
  return JSON.stringify({ cards, pages })
})()`)
const sc = JSON.parse(skillCheck)
check('#2 推荐技能 50 个（每页10，5页）', sc.cards === 10 && sc.pages === 5, skillCheck)
check('#2 推荐技能总数 50', await ev(`window.dshw.getSkills().then(r => r.items.length)`) === 50)
ws.close()
process.exit(0)
