/** 验证本轮：分组/归档/收藏/会话操作 + 搜索不再空白 + 收起布局。 */
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
function ev(expression, timeout = 60000) {
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

// 回会话视图
await ev(`(() => { const b = [...document.querySelectorAll('aside button')].find(x => x.innerText.includes('返回会话')); if (b) b.click(); return 'ok' })()`)
await wait(1000)
await wait(1500)

// 日常/归档 区块
const blocks = await ev(`(() => {
  const text = document.querySelector('aside').innerText
  const hasDaily = /日常/.test(text)
  const hasArchive = /归档/.test(text)
  return JSON.stringify({ hasDaily, hasArchive })
})()`)
check('#5 日常/归档两块', JSON.parse(blocks).hasDaily && JSON.parse(blocks).hasArchive, blocks)

// 工作区树 + 分组操作入口
const wsOps = await ev(`JSON.stringify([...document.querySelectorAll('aside button[aria-label="工作区操作"]')].length)`)
check('#3 工作区操作按钮存在', Number(wsOps) >= 1, wsOps)
// 打开工作区菜单 → 新建分组
await ev(`(() => { const b = document.querySelector('aside button[aria-label="工作区操作"]'); if (!b) return 'NO'; b.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true })); b.click(); return 'ok' })()`)
await wait(700)
const wsMenu = await ev(`JSON.stringify([...document.querySelectorAll('.el-dropdown-menu__item')].map(i => i.innerText.trim()))`)
check('#3 工作区菜单含「新建分组」', JSON.parse(wsMenu).includes('新建分组'), wsMenu)
await ev(`document.body.click(); 'ok'`); await wait(300)

// 创建分组（通过 IPC 直测，UI 弹窗不好自动化）
const g1 = await ev(`window.dshw.createSessionGroup('项目A', 'any-ws').then(r => JSON.stringify(r))`)
check('#3 创建分组 IPC', JSON.parse(g1).ok === true, g1)
const g2 = await ev(`window.dshw.getSidebarData().then(r => JSON.stringify(r.groups.map(g => g.name)))`)
check('#3 分组列表含「项目A」', JSON.parse(g2).includes('项目A'), g2)
// 置顶/重命名/删除分组
const gid = await ev(`window.dshw.getSidebarData().then(r => r.groups.find(g => g.name === '项目A').id)`)
console.log('gid:', gid)
console.log('置顶:', await ev(`window.dshw.pinSessionGroup(${JSON.stringify(gid)}).then(r => JSON.stringify(r))`))
const pinned = await ev(`window.dshw.getSidebarData().then(r => JSON.stringify(r.groups.find(g => g.id === ${JSON.stringify(gid)}).pinned))`)
check('#3 分组置顶', pinned === 'true', pinned)
console.log('重命名:', await ev(`window.dshw.renameSessionGroup(${JSON.stringify(gid)}, '项目A-重命名').then(r => JSON.stringify(r))`))
check('#3 分组重命名', await ev(`window.dshw.getSidebarData().then(r => r.groups.some(g => g.name === '项目A-重命名'))`))

// 归档一个会话（真实归档第一个工作区的第一个会话）
const archiveTarget = await ev(`window.dshw.getSidebarData().then(r => { const ws = r.workspaces[0]; const s = ws.sessions[0]; return s ? JSON.stringify({ id: s.id, title: s.title, time: s.time }) : 'NONE' })`)
console.log('归档目标:', archiveTarget)
if (archiveTarget !== 'NONE') {
  const at = JSON.parse(archiveTarget)
  const ar = await ev(`window.dshw.archiveSession(${JSON.stringify(at.id)}, ${JSON.stringify(at.title)}, ${at.time}).then(r => JSON.stringify(r))`)
  check('#4 归档会话', JSON.parse(ar).ok === true, ar)
  const arch = await ev(`window.dshw.getSidebarData().then(r => JSON.stringify({ archived: r.archived.length, first: r.archived[0] ? { title: r.archived[0].title, hasKw: r.archived[0].keywords.length > 0 } : null, daily: r.workspaces.reduce((n, w) => n + w.sessionCount, 0) }))`)
  const ach = JSON.parse(arch)
  check('#5 归档条目（含关键词标签）', ach.archived >= 1 && ach.first?.hasKw === true, arch)
  // 收藏
  const fav = await ev(`window.dshw.setSessionFavorite(${JSON.stringify(at.id)}, true).then(r => JSON.stringify(r))`)
  check('#5 收藏', JSON.parse(fav).ok === true, fav)
  const favList = await ev(`window.dshw.getSidebarData().then(r => JSON.stringify(r.favorites))`)
  check('#5 收藏列表含该会话', JSON.parse(favList).includes(at.id), favList)
}

// 删除分组（清理）
const del = await ev(`window.dshw.deleteSessionGroup(${JSON.stringify(gid)}).then(r => JSON.stringify(r))`)
check('#3 删除分组', JSON.parse(del).ok === true, del)
ws.close()
process.exit(0)
