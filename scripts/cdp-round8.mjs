/** 验证：改名 + 工作区操作合并（导入会话/打开工作文件夹）。 */
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

// 应用名
const appInfo = await ev(`window.dshw.getAppInfo().then(r => JSON.stringify({ name: r.appName, ws: r.workspacePath }))`)
console.log('应用信息:', appInfo)
check('应用名 = DSH 桌面', appInfo.includes('DSH 桌面'), appInfo)
check('工作区路径已更新到新文件夹', appInfo.includes('DSH-Desktop'), appInfo)

// 侧边栏标题
check('侧边栏标题 DSH 桌面', await ev(`document.querySelector('aside').innerText.includes('DSH 桌面')`))
// 窗口标题
console.log('窗口标题:', await ev(`document.title`))

// 展开侧边栏
await ev(`(() => { const w = document.querySelector('aside').getBoundingClientRect().width; if (w < 200) { const b = document.querySelector('aside button[aria-label="收起或展开任务栏"]'); if (b) b.click(); } return 'ok' })()`)
await wait(800)
await ev(`(() => { const b = [...document.querySelectorAll('aside button')].find(x => x.innerText.includes('返回会话')); if (b) b.click(); return 'ok' })()`)
await wait(1200)

// #1 工作区菜单：导入会话 + 打开工作文件夹
await ev(`(() => { const b = document.querySelector('aside button[aria-label="工作区操作"]'); if (!b) return 'NO'; b.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true })); b.click(); return 'ok' })()`)
await wait(800)
const menu = await ev(`JSON.stringify([...document.querySelectorAll('.el-dropdown-menu__item')].map(i => i.innerText.trim()))`)
const m = JSON.parse(menu)
check('#1 工作区菜单含「导入会话（到本工作区）」', m.includes('导入会话（到本工作区）'), menu)
check('#1 工作区菜单含「打开工作文件夹」', m.includes('打开工作文件夹'), menu)
check('#1 工作区菜单不再含旧底部导入按钮（已移除）', await ev(`document.querySelector('aside').innerText.includes('导入其他电脑的会话')`) === false)
await ev(`document.body.click(); 'ok'`); await wait(300)
ws.close()
process.exit(0)
