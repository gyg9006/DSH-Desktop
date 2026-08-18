/** 完整验证：分页 + 工作区树展开。 */
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

// 1) 确保侧边栏展开且回到会话视图
await ev(`(() => { const w = document.querySelector('aside').getBoundingClientRect().width; if (w < 200) { const b = document.querySelector('aside button[aria-label="收起或展开任务栏"]'); if (b) b.click(); } return 'ok' })()`)
await wait(600)
await ev(`(() => { const b = [...document.querySelectorAll('aside button')].find(x => x.innerText.includes('返回会话')); if (b) b.click(); return 'ok' })()`)
await wait(1000)

// 2) 工作区树 + 展开
const tree = await ev(`JSON.stringify([...document.querySelectorAll('aside div')].filter(d => [...d.querySelectorAll('button')].some(b => (b.getAttribute('aria-label')||'') === '工作区操作')).map(r => (r.innerText||'').trim().replace(/\n/g,' / ')).slice(0,4))`)
const tr = JSON.parse(tree)
check('#3 工作区树显示（含会话数）', tr.length >= 1, tree)
await ev(`(() => { const btn = document.querySelector('aside button[aria-label="工作区操作"]'); if (!btn) return 'NO'; btn.closest('[class*="group"]')?.click(); return 'ok' })()`)
await wait(800)
const afterExpand = await ev(`(() => { const text = document.querySelector('aside').innerText; const lines = text.split('\n').filter(l => l.trim()); return JSON.stringify({ sessionLines: lines.filter(l => /session-/.test(l) || /新对话/.test(l)).slice(0, 5), total: lines.length }) })()`)
console.log('展开后会话:', afterExpand)
check('#3 展开显示会话条目', JSON.parse(afterExpand).sessionLines.length >= 1, afterExpand)

// 3) 插件分页
await ev(`(() => { const b = document.querySelector('aside button[aria-label="打开设置"]'); if (b) b.click(); return 'ok' })()`)
await wait(600)
await ev(`(() => { const b = [...document.querySelectorAll('aside button')].find(x => x.innerText.includes('插件')); if (b) b.click(); return 'ok' })()`)
await wait(1500)
const p1 = await ev(`(() => {
  const active = [...document.querySelectorAll('.plugin-tabs .el-tab-pane')].find(p => p.offsetParent !== null)
  if (!active) return JSON.stringify({ cards: 0, pages: 0, err: 'NO_ACTIVE', tabs: [...document.querySelectorAll('.plugin-tabs .el-tabs__item')].map(t => t.innerText.trim()) })
  const cards = [...active.querySelectorAll('.rounded-lg')].length
  const pager = active.querySelector('.el-pagination')
  return JSON.stringify({ cards, pages: pager ? [...pager.querySelectorAll('.el-pager li')].length : 0 })
})()`)
const pc = JSON.parse(p1)
check('#2 推荐插件每页 10 个 / 5 页', pc.cards === 10 && pc.pages === 5, p1)
await ev(`(() => { const t = [...document.querySelectorAll('.plugin-tabs .el-tabs__item')].find(x => x.innerText.includes('推荐技能')); if (t) t.click(); return 'ok' })()`)
await wait(1200)
const p2 = await ev(`(() => {
  const active = [...document.querySelectorAll('.plugin-tabs .el-tab-pane')].find(p => p.offsetParent !== null)
  if (!active) return JSON.stringify({ cards: 0, pages: 0, err: 'NO_ACTIVE' })
  const cards = [...active.querySelectorAll('.rounded-lg')].length
  const pager = active.querySelector('.el-pagination')
  return JSON.stringify({ cards, pages: pager ? [...pager.querySelectorAll('.el-pager li')].length : 0 })
})()`)
const sc = JSON.parse(p2)
check('#2 推荐技能每页 10 个 / 5 页（共50）', sc.cards === 10 && sc.pages === 5, p2)
check('#2 技能总数 = 50', await ev(`window.dshw.getSkills().then(r => r.items.length)`) === 50)
ws.close()
process.exit(0)
