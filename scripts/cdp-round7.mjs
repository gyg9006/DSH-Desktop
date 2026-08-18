/** 验证本轮：日常工作/归档导航切换 + 视图选项功能。 */
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

// 展开侧边栏（可能收起态）
await ev(`(() => { const w = document.querySelector('aside').getBoundingClientRect().width; if (w < 200) { const b = document.querySelector('aside button[aria-label="收起或展开任务栏"]'); if (b) b.click(); } return 'ok' })()`)
await wait(800)
// 回会话视图（若在设置视图）
await ev(`(() => { const b = [...document.querySelectorAll('aside button')].find(x => x.innerText.includes('返回会话')); if (b) b.click(); return 'ok' })()`)
await wait(1200)

// #1 顶部导航：日常工作 / 归档
const nav = await ev(`(() => {
  const aside = document.querySelector('aside')
  const btns = [...aside.querySelectorAll('button')].filter(b => b.innerText.trim() === '日常工作' || b.innerText.startsWith('归档'))
  return JSON.stringify(btns.map(b => b.innerText.trim()))
})()`)
check('#1 顶部「日常工作/归档」导航', JSON.parse(nav).length >= 2, nav)
// 日常视图内容
const daily = await ev(`(() => {
  const aside = document.querySelector('aside')
  return JSON.stringify({ hasWs: aside.innerText.includes('deepseek_workspace'), hasService: aside.innerText.includes('服务'), hasStart: [...aside.querySelectorAll('button')].some(b => b.innerText.includes('开始对话')) })
})()`)
check('#1 日常视图包含工作区/服务/开始对话', JSON.parse(daily).hasWs && JSON.parse(daily).hasStart, daily)

// #2 视图选项：点击打开 → 分组方式/排序方式
await ev(`(() => { const b = document.querySelector('aside button[aria-label="视图选项"]'); if (!b) return 'NO'; b.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); return 'ok' })()`)
await wait(900)
const menu = await ev(`JSON.stringify([...document.querySelectorAll('.el-dropdown-menu__item')].map(i => i.innerText.trim()))`)
const m = JSON.parse(menu)
check('#2 视图选项打开且含分组方式/排序方式', m.includes('分组方式') && m.includes('按工作区') && m.includes('单列表') && m.includes('排序方式') && m.includes('手动排序') && m.includes('最近更新'), menu)

// 选「单列表」→ 桌面视图切换为单列表
await ev(`(() => { const i = [...document.querySelectorAll('.el-dropdown-menu__item')].find(x => x.innerText.trim() === '单列表'); if (i) i.click(); return 'ok' })()`)
await wait(900)
const flatView = await ev(`(() => {
  const aside = document.querySelector('aside')
  return JSON.stringify({ hasFlat: aside.innerText.includes('全部会话'), hasWsHeader: aside.innerText.includes('deepseek_workspace') })
})()`)
check('#2 单列表模式生效（全部会话平铺）', JSON.parse(flatView).hasFlat === true, flatView)
// 配置已持久化
const cfg = await ev(`window.dshw.getConfig().then(c => JSON.stringify(c.sidebarView))`)
check('#2 视图选项已持久化到配置', cfg.includes('"flat"'), cfg)

// 切回按工作区
await ev(`(() => { const b = document.querySelector('aside button[aria-label="视图选项"]'); if (b) b.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); return 'ok' })()`)
await wait(700)
await ev(`(() => { const i = [...document.querySelectorAll('.el-dropdown-menu__item')].find(x => x.innerText.trim() === '按工作区'); if (i) i.click(); return 'ok' })()`)
await wait(900)
check('#2 切回按工作区', await ev(`document.querySelector('aside').innerText.includes('deepseek_workspace')`))

// 归档导航：切到归档
await ev(`(() => { const b = [...document.querySelectorAll('aside button')].find(x => x.innerText.startsWith('归档')); if (b) b.click(); return 'ok' })()`)
await wait(700)
const archView = await ev(`(() => {
  const aside = document.querySelector('aside')
  return JSON.stringify({ hasKeywordSearch: aside.innerText.includes('按关键词搜索'), hasTimeSearch: aside.innerText.includes('按时间搜索'), hasEmpty: aside.innerText.includes('暂无归档会话') })
})()`)
check('#1 归档导航下为归档视图（搜索+列表）', JSON.parse(archView).hasKeywordSearch && JSON.parse(archView).hasTimeSearch, archView)
ws.close()
process.exit(0)
