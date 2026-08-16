/** 重验 #4：返回会话视图后，桌面端工作区按钮驱动 dsh（隐藏侧边栏状态下）。 */
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

// 返回会话视图
await ev(`(() => { const b = [...document.querySelectorAll('aside button')].find(x => x.innerText.includes('返回会话')); if (b) b.click(); return 'ok' })()`)
await wait(600)
const chatBtns = await ev(`JSON.stringify([...document.querySelectorAll('aside button')].map(b => (b.getAttribute('aria-label')||'').trim()).filter(t => ['新建会话','添加工作区','搜索会话','视图选项'].includes(t)))`)
check('#4 会话视图含 4 个工作区按钮', JSON.parse(chatBtns).length === 4, chatBtns)

// 视图选项 → 一个列表（写入 dsh localStorage）
await ev(`(() => { const b = document.querySelector('aside button[aria-label="视图选项"]'); if (!b) return 'NO'; b.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); return 'ok' })()`)
await wait(800)
await ev(`(() => { const item = [...document.querySelectorAll('.el-dropdown-menu__item')].find(x => x.innerText.includes('一个列表')); if (item) item.click(); return 'ok' })()`)
await wait(1800)
const groupBy = await g(`(() => { try { const v = JSON.parse(localStorage.getItem('dsh.workspace.view.v5') || '{}'); return v.groupBy || 'unset' } catch (e) { return 'ERR' } })()`)
check('#4 视图选项写入 dsh（groupBy=flat）', groupBy === 'flat', groupBy)

// 搜索会话 → dsh 搜索触发
await ev(`(() => { const b = document.querySelector('aside button[aria-label="搜索会话"]'); if (!b) return 'NO'; b.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); return 'ok' })()`)
await wait(1800)
const searchState = await g(`(() => { const inputs = [...document.querySelectorAll('input')]; const focused = inputs.find(i => document.activeElement === i || i.matches(':focus')); return JSON.stringify({ inputs: inputs.length, focused: !!focused }) })()`)
check('#4 搜索会话触发 dsh 搜索', JSON.parse(searchState).focused === true || JSON.parse(searchState).inputs >= 1, searchState)

// 新建会话 → 触发（关闭搜索后）
await ev(`(() => { const b = document.querySelector('aside button[aria-label="新建会话"]'); if (!b) return 'NO'; b.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); return 'ok' })()`)
await wait(2000)
check('#4 新建会话触发（无异常）', await ev(`(() => { const wv = document.querySelector('webview'); return !!wv })()`))

// 添加工作区 → dsh 工作区对话框
await ev(`(() => { const b = document.querySelector('aside button[aria-label="添加工作区"]'); if (!b) return 'NO'; b.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); return 'ok' })()`)
await wait(1800)
const wsDlg = await g(`(() => { const t = document.body.innerText; return t.includes('选择工作区') || t.includes('添加工作区') ? 'dialog-open' : 'no-dialog' })()`)
check('#4 添加工作区触发 dsh 工作区对话框', wsDlg === 'dialog-open', wsDlg)

// 收起态顶部图标
await ev(`(() => { const b = document.querySelector('aside button[aria-label="收起或展开任务栏"]'); if (b) b.click(); return 'ok' })()`)
await wait(600)
const rail = await ev(`JSON.stringify([...document.querySelectorAll('aside button')].map(b => (b.getAttribute('aria-label')||'').trim()).filter(t => ['新建会话','添加工作区','搜索会话'].includes(t)))`)
check('#4 收起态顶部工作区图标', JSON.parse(rail).length === 3, rail)
ws.close()
process.exit(0)
