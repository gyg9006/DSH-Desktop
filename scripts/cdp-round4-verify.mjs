/** 本轮 4 项修复综合验证。 */
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
const check = (n, ok, d = '') => console.log(`${ok ? '✓' : '✗'} ${n}${d ? '  ' + d : ''}`)

// ---------- #1 设置视图在左下角按钮 ----------
const topNav = await ev(`JSON.stringify([...document.querySelectorAll('aside .mx-2 button')].map(b => b.innerText.trim()))`)
check('#1 顶部导航已去掉会话/设置切换', !Array.isArray(JSON.parse(topNav)) || JSON.parse(topNav).length === 0, `topNav=${topNav}`)
// 底部设置按钮存在（展开态）
const bottomBtns = await ev(`JSON.stringify([...document.querySelectorAll('aside button')].map(b => (b.getAttribute('aria-label') || b.innerText.trim())).filter(t => t === '打开设置'))`)
check('#1 左下角设置按钮存在', JSON.parse(bottomBtns).length === 1, bottomBtns)
// 点击设置 → 设置视图 + 返回会话
await ev(`document.querySelector('aside button[aria-label="打开设置"]').click(); 'ok'`)
await wait(600)
check('#1 设置视图打开（含返回会话）', await ev(`[...document.querySelectorAll('aside button')].some(b => b.innerText.includes('返回会话'))`))
check('#1 设置子项含服务启停', await ev(`[...document.querySelectorAll('aside button')].some(b => b.innerText.includes('启动') || b.innerText.includes('停止'))`))
await ev(`(() => { const b = [...document.querySelectorAll('aside button')].find(x => x.innerText.includes('返回会话')); if (b) b.click(); return 'ok' })()`)
await wait(500)
check('#1 返回会话正常', await ev(`[...document.querySelectorAll('aside button')].some(b => b.innerText.includes('开始对话'))`))

// ---------- #4 工作区操作行（展开态） ----------
check('#4 展开态工作区操作行（新建/添加/搜索/视图）', await ev(`JSON.stringify([...document.querySelectorAll('aside button')].map(b => (b.getAttribute('aria-label')||b.innerText.trim())).filter(t => ['新建会话','添加工作区','搜索会话','视图选项'].includes(t)).length) === '4'`))

// ---------- 收起态：顶部工作区图标 ----------
await ev(`document.querySelector('aside button[aria-label="收起或展开任务栏"]').click(); 'ok'`)
await wait(600)
const collapsedRail = await ev(`JSON.stringify([...document.querySelectorAll('aside button')].map(b => (b.getAttribute('aria-label')||'').trim()).filter(t => ['新建会话','添加工作区','搜索会话'].includes(t)))`)
check('#4 收起态顶部显示工作区图标', JSON.parse(collapsedRail).length === 3, collapsedRail)
await ev(`document.querySelector('aside button[aria-label="收起或展开任务栏"]').click(); 'ok'`)
await wait(600)

// ---------- #2 通用设置：打开配置文件按钮 ----------
await ev(`document.querySelector('aside button[aria-label="打开设置"]').click(); 'ok'`)
await wait(500)
await ev(`(() => { const b = [...document.querySelectorAll('aside button')].find(x => x.innerText.includes('通用设置')); if (b) b.click(); return 'ok' })()`)
await wait(900)
check('#2 通用设置含「打开配置文件」按钮', await ev(`[...document.querySelectorAll('button')].some(b => b.innerText.includes('打开配置文件'))`))

// ---------- #3 插件：推荐标签不遮挡 + 刷新 + 50 个 ----------
await ev(`(() => { const nav = document.querySelector('.settings-dialog nav'); const b = [...nav.querySelectorAll('button')].find(x => x.innerText.includes('插件')); if (b) b.click(); return 'ok' })()`)
await wait(900)
const pluginCount = await ev(`(() => { const pane = document.querySelector('.plugin-tabs .el-tab-pane'); return [...pane.querySelectorAll('.rounded-lg')].length })()`)
check('#3 推荐插件列表 50 个', pluginCount === 50, `count=${pluginCount}`)
// 推荐标签是否遮挡标题：检查标签与标题是否在同一行内联
const badgeLayout = await ev(`(() => {
  const card = [...document.querySelectorAll('.plugin-tabs .el-tab-pane .rounded-lg')][0]
  const badge = card.querySelector('.bg-green-500')
  const title = card.querySelector('.text-sm.font-semibold')
  if (!badge || !title) return 'MISSING'
  const br = badge.getBoundingClientRect(), tr = title.getBoundingClientRect()
  return JSON.stringify({ badgeY: Math.round(br.y), titleY: Math.round(tr.y), badgeTop: Math.round(br.top), titleTop: Math.round(tr.top) })
})()`)
const bl = JSON.parse(badgeLayout)
check('#3 推荐标签与标题同排不遮挡', Math.abs(bl.badgeTop - bl.titleTop) < 8, badgeLayout)
check('#3 刷新按钮存在', await ev(`[...document.querySelectorAll('button')].some(b => b.innerText.trim() === '刷新')`))
ws.close()
process.exit(0)
