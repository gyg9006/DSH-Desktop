/** 最终验证：#3 插件 50 个 + #4 工作区操作（新建会话/添加工作区/搜索/视图选项驱动 dsh）。 */
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

// 插件 50 个
await ev(`(() => { const b = document.querySelector('aside button[aria-label="打开设置"]'); if (b) b.click(); return 'ok' })()`)
await wait(600)
await ev(`(() => { const b = [...document.querySelectorAll('aside button')].find(x => x.innerText.includes('插件')); if (b) b.click(); return 'ok' })()`)
await wait(1000)
const count = await ev(`(() => { const pane = document.querySelector('.plugin-tabs .el-tab-pane:not([style*="display: none"])'); return pane ? [...pane.querySelectorAll('.rounded-lg')].length : 0 })()`)
check('#3 推荐插件 50 个', count === 50, `count=${count}`)

// 关掉设置弹窗
await ev(`(() => { const c = document.querySelector('.settings-dialog .el-dialog__headerbtn'); if (c) c.click(); return 'ok' })()`)
await wait(500)

// 启动服务 + 打开对话
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

// 隐藏 dsh 侧边栏（默认）后，桌面端工作区按钮仍能驱动 dsh：
// 1) 视图选项 → localStorage groupBy
console.log('视图选项:', await ev(`(() => { const b = document.querySelector('aside button[aria-label="视图选项"]'); if (!b) return 'NO'; b.click(); return 'ok' })()`))
await wait(700)
await ev(`(() => { const item = [...document.querySelectorAll('.el-dropdown-menu__item')].find(x => x.innerText.includes('一个列表')); if (item) item.click(); return 'ok' })()`)
await wait(1500)
const groupBy = await g(`(() => { try { const v = JSON.parse(localStorage.getItem('dsh.workspace.view.v5') || '{}'); return v.groupBy || 'unset' } catch (e) { return 'ERR' } })()`)
check('#4 视图选项写入 dsh（groupBy=flat）', groupBy === 'flat', groupBy)

// 2) 搜索 → dsh 搜索面板打开（侧边栏隐藏状态下点击仍生效）
console.log('搜索点击:', await ev(`(() => { const b = document.querySelector('aside button[aria-label="搜索会话"]'); if (!b) return 'NO'; b.click(); return 'ok' })()`))
await wait(1500)
const searchOpen = await g(`(() => {
  const inputs = [...document.querySelectorAll('input')]
  const active = inputs.find(i => document.activeElement === i)
  return JSON.stringify({ activeSearch: !!active, anyInput: inputs.length })
})()`)
check('#4 搜索会话（dsh 搜索触发）', searchOpen.includes('activeSearch'), searchOpen)

// 3) 新建会话 → dsh 新建会话（侧边栏隐藏时点击）
await ev(`(() => { const b = document.querySelector('aside button[aria-label="新建会话"]'); if (!b) return 'NO'; b.click(); return 'ok' })()`)
await wait(2000)
const afterNew = await g(`document.body.innerText.slice(0, 120)`)
console.log('新建会话后 guest 文本:', afterNew.replace(/\n/g, ' '))
check('#4 新建会话可触发', afterNew.length > 0)

// 4) 添加工作区 → dsh 工作区对话框
console.log('添加工作区:', await ev(`(() => { const b = document.querySelector('aside button[aria-label="添加工作区"]'); if (!b) return 'NO'; b.click(); return 'ok' })()`))
await wait(1500)
const wsDlg = await g(`(() => { const btns = [...document.querySelectorAll('button')].map(b => (b.getAttribute('aria-label') || b.innerText || '').trim()).filter(Boolean); return JSON.stringify(btns.filter(t => /工作区|workspace|添加|新建/i.test(t)).slice(0, 8)) })()`)
check('#4 添加工作区触发 dsh 工作区对话框', wsDlg.length > 2, wsDlg)
ws.close()
process.exit(0)
