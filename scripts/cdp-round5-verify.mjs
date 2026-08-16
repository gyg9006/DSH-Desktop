/** 本轮 4 项修复综合验证：工作区字样位置/视图选项 / 分页50技能 / 工作区树 / 收起态。 */
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

// ---------- #1 工作区字样在左 + 视图选项菜单 ----------
await wait(1500) // 等待工作区加载
const wsRow = await ev(`(() => {
  const row = document.querySelector('aside .border-gray-100.p-1.5') || [...document.querySelectorAll('aside .rounded-lg')].find(x => x.innerText.includes('工作区'))
  if (!row) return 'NO_ROW'
  const text = row.innerText
  const firstChild = row.firstElementChild
  const firstText = firstChild ? firstChild.innerText.trim() : ''
  return JSON.stringify({ text, firstText })
})()`)
const wr = JSON.parse(wsRow)
check('#1 工作区字样在左（操作行首位）', wr.firstText === '工作区', wsRow)

// 视图选项菜单：分组方式 + 排序方式
await ev(`(() => { const b = document.querySelector('aside button[aria-label="视图选项"]'); if (b) b.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); return 'ok' })()`)
await wait(800)
const viewMenu = await ev(`JSON.stringify([...document.querySelectorAll('.el-dropdown-menu__item')].map(i => i.innerText.trim()))`)
const vm = JSON.parse(viewMenu)
check('#1 视图选项与 dsh 一致（分组+排序）', vm.includes('分组方式') && vm.includes('按工作区') && vm.includes('单列表') && vm.includes('排序方式') && vm.includes('手动排序') && vm.includes('最近更新'), viewMenu)
// 选「单列表」→ 写入 dsh groupBy
await ev(`(() => { const i = [...document.querySelectorAll('.el-dropdown-menu__item')].find(x => x.innerText.trim() === '单列表'); if (i) i.click(); return 'ok' })()`)
await wait(400)
// 选「最近更新」→ 写入 dsh orderBy
await ev(`(() => { const b = document.querySelector('aside button[aria-label="视图选项"]'); if (b) b.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); return 'ok' })()`)
await wait(600)
await ev(`(() => { const i = [...document.querySelectorAll('.el-dropdown-menu__item')].find(x => x.innerText.trim() === '最近更新'); if (i) i.click(); return 'ok' })()`)
await wait(400)

// ---------- #3 工作区树 ----------
const wsTree = await ev(`(() => {
  const items = [...document.querySelectorAll('aside .group')]
  return JSON.stringify(items.map(el => el.innerText.trim().split('\n')[0]).slice(0, 6))
})()`)
check('#3 工作区树（含工作文件夹）', JSON.parse(wsTree).length >= 1, wsTree)
// 展开第一个工作区 → 会话列表
await ev(`(() => { const row = [...document.querySelectorAll('aside .group')][0]; if (row) row.click(); return 'ok' })()`)
await wait(600)
const sessions = await ev(`(() => {
  const items = [...document.querySelectorAll('aside .space-y-0.5 .border-l div')]
  return JSON.stringify(items.filter(el => el.querySelector('span')).map(el => el.innerText.trim()).slice(0, 8))
})()`)
check('#3 工作区可展开显示会话列表', JSON.parse(sessions).length >= 1, sessions)

// 工作区操作菜单（重命名/删除）
await ev(`(() => { const btn = document.querySelector('aside button[aria-label="工作区操作"]'); if (!btn) return 'NO'; btn.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true })); btn.click(); return 'ok' })()`)
await wait(700)
const wsOps = await ev(`JSON.stringify([...document.querySelectorAll('.el-dropdown-menu__item')].map(i => i.innerText.trim()))`)
check('#3 工作区操作（重命名/删除）', JSON.parse(wsOps).includes('重命名') && JSON.parse(wsOps).includes('删除工作区'), wsOps)
await ev(`document.body.click(); 'ok'`)
await wait(300)

// ---------- 收起态顶部图标 ----------
await ev(`(() => { const b = document.querySelector('aside button[aria-label="收起或展开任务栏"]'); if (b) b.click(); return 'ok' })()`)
await wait(600)
const rail = await ev(`JSON.stringify([...document.querySelectorAll('aside button')].map(b => (b.getAttribute('aria-label')||'').trim()).filter(t => ['新建会话','添加工作区','搜索会话'].includes(t)))`)
check('#4 收起态顶部工作区图标', JSON.parse(rail).length === 3, rail)
await ev(`(() => { const b = document.querySelector('aside button[aria-label="收起或展开任务栏"]'); if (b) b.click(); return 'ok' })()`)
await wait(600)

// ---------- #2 插件分页 + 50 技能 ----------
await ev(`(() => { const b = document.querySelector('aside button[aria-label="打开设置"]'); if (b) b.click(); return 'ok' })()`)
await wait(600)
await ev(`(() => { const b = [...document.querySelectorAll('aside button')].find(x => x.innerText.includes('插件')); if (b) b.click(); return 'ok' })()`)
await wait(1200)
const pluginPane = await ev(`(() => { const pane = document.querySelector('.plugin-tabs .el-tab-pane:not([style*="display: none"])'); return pane ? [...pane.querySelectorAll('.rounded-lg')].length : 0 })()`)
check('#2 推荐插件分页（每页10个）', pluginPane === 10, `pane=${pluginPane}`)
const pagination = await ev(`(() => { const p = document.querySelector('.plugin-tabs .el-pagination'); return p ? JSON.stringify({ total: [...p.querySelectorAll('.el-pager li')].length, hasNext: !!p.querySelector('.btn-next:not([disabled])') }) : 'NO_PAGER' })()`)
check('#2 插件分页控件（5页）', pagination.includes('"total":5'), pagination)
// 推荐技能页：50 个，每页 10
await ev(`(() => { const t = [...document.querySelectorAll('.plugin-tabs .el-tabs__item')].find(x => x.innerText.includes('推荐技能')); if (t) t.click(); return 'ok' })()`)
await wait(1000)
const skillInfo = await ev(`(() => {
  const pane = document.querySelector('.plugin-tabs .el-tab-pane:not([style*="display: none"])')
  const cards = pane ? [...pane.querySelectorAll('.rounded-lg')].length : 0
  const p = pane ? pane.querySelector('.el-pagination') : null
  const pages = p ? [...p.querySelectorAll('.el-pager li')].length : 0
  return JSON.stringify({ cards, pages })
})()`)
const si = JSON.parse(skillInfo)
check('#2 推荐技能 50 个，每页 10（5页）', si.cards === 10 && si.pages === 5, skillInfo)
ws.close()
process.exit(0)
