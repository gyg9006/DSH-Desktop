/** 验证 #2 打开配置文件 + #3 插件 50 个/标签/刷新。 */
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
function ev(expression, timeout = 15000) {
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

await ev(`(() => { const b = document.querySelector('aside button[aria-label="打开设置"]'); if (b) b.click(); return 'ok' })()`)
await wait(600)
await ev(`(() => { const b = [...document.querySelectorAll('aside button')].find(x => x.innerText.includes('通用设置')); if (b) b.click(); return 'ok' })()`)
await wait(900)
check('#2 通用设置「打开配置文件」按钮', await ev(`[...document.querySelectorAll('button')].some(b => b.innerText.includes('打开配置文件'))`))

await ev(`(() => { const nav = document.querySelector('.settings-dialog nav'); const b = [...nav.querySelectorAll('button')].find(x => x.innerText.includes('插件')); if (b) b.click(); return 'ok' })()`)
await wait(1000)
const count = await ev(`(() => { const pane = document.querySelector('.plugin-tabs .el-tab-pane:not([style*="display: none"])'); if (!pane) return 'NO_PANE'; return [...pane.querySelectorAll('.rounded-lg')].length })()`)
check('#3 推荐插件 50 个', count === 50, `count=${count}`)
const badgeLayout = await ev(`(() => {
  const pane = document.querySelector('.plugin-tabs .el-tab-pane:not([style*="display: none"])')
  const card = pane ? [...pane.querySelectorAll('.rounded-lg')][0] : null
  if (!card) return 'NO_CARD'
  const badge = card.querySelector('.bg-green-500')
  const title = card.querySelector('.text-sm.font-semibold')
  if (!badge || !title) return 'MISSING'
  return JSON.stringify({ badgeTop: Math.round(badge.getBoundingClientRect().top), titleTop: Math.round(title.getBoundingClientRect().top) })
})()`)
let bl = null
try { bl = JSON.parse(badgeLayout) } catch { bl = null }
check('#3 推荐标签与标题同排不遮挡', !!bl && Math.abs(bl.badgeTop - bl.titleTop) < 8, badgeLayout)
check('#3 刷新按钮', await ev(`[...document.querySelectorAll('button')].some(b => b.innerText.trim() === '刷新')`))
console.log('点刷新:', await ev(`(() => { const b = [...document.querySelectorAll('button')].find(x => x.innerText.trim() === '刷新'); if (!b) return 'NO'; b.click(); return 'ok' })()`))
await wait(1500)
const after = await ev(`(() => { const pane = document.querySelector('.plugin-tabs .el-tab-pane:not([style*="display: none"])'); return pane ? [...pane.querySelectorAll('.rounded-lg')].length : 0 })()`)
check('#3 刷新后列表正常', after >= 50, `after=${after}`)
ws.close()
process.exit(0)
