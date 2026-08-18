/** UI 重设计验证：完成向导 → 检查主页 Hero 布局与环境状态条。 */
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
function ev(expression, timeout = 8000) {
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
const clickByText = (text) =>
  ev(`(() => { const btn = [...document.querySelectorAll('button')].find(b => b.innerText.trim().includes(${JSON.stringify(text)})); if (!btn || btn.disabled) return 'NOT_FOUND_OR_DISABLED'; btn.click(); return 'clicked'; })()`)
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

// 完成向导
await clickByText('下一步')
await wait(800)
await clickByText('跳过')
await wait(800)
await clickByText('完成，开始使用')
await wait(1500)

// 检查主页布局
console.log(
  '主页:',
  await ev(`JSON.stringify({
    heroTitle: document.body.innerText.includes('DSH Workbench'),
    subtitle: document.body.innerText.includes('拷贝即迁移'),
    ctas: [...document.querySelectorAll('button')].filter(b => b.innerText.includes('一键启动服务') || b.innerText.includes('打开设置')).length,
    envStripDots: [...document.querySelectorAll('.status-dot')].filter(d => d.className.includes('status-dot--running')).length,
    workspaceLine: document.body.innerText.includes('工作文件夹'),
    hasBigCards: [...document.querySelectorAll('.rounded-xl')].length
  })`)
)
// 打开设置确认新导航样式
await ev(`(document.querySelectorAll('aside button')[2]).click(); 'ok'`)
await wait(800)
console.log(
  '设置:',
  await ev(`JSON.stringify({ tabs: document.querySelectorAll('.settings-dialog nav button').length, activeBg: document.querySelector('.settings-dialog nav button.bg-brand-50') !== null })`)
)
ws.close()
process.exit(0)
