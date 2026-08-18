/** 最终冒烟：主界面正常、无向导、侧边栏可收起展开、设置 7 页签齐全。 */
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
function ev(expression, timeout = 10000) {
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

const checks = []
const check = (n, ok, d = '') => { checks.push([n, ok, d]); console.log(`${ok ? '✓' : '✗'} ${n}${d ? '  ' + d : ''}`) }

check('主界面（无向导）', await ev(`!document.querySelector('.el-step') && !!document.querySelector('aside')`))
check('设置页签 7 个', await ev(`(() => { const btn = [...document.querySelectorAll('button')].find(b => b.innerText.includes('设置')); btn?.click(); return 'x' })(); 'ok'`) && await ev(`(async () => { await new Promise(r => setTimeout(r, 700)); const dlg = document.querySelector('.settings-dialog'); return dlg ? [...dlg.querySelectorAll('nav button')].map(b => b.innerText.trim()).join(',') : 'NO_DLG' })()`))
// 收起/展开闭环
const w0 = await ev(`document.querySelector('aside').getBoundingClientRect().width`)
await ev(`document.querySelector('aside button[aria-label="收起或展开任务栏"]').click(); 'ok'`)
await wait(500)
const w1 = await ev(`document.querySelector('aside').getBoundingClientRect().width`)
await ev(`document.querySelector('aside button[aria-label="收起或展开任务栏"]').click(); 'ok'`)
await wait(500)
const w2 = await ev(`document.querySelector('aside').getBoundingClientRect().width`)
check('侧边栏收起/展开闭环', w1 === 48 && w2 === 260, `w=${w0}->${w1}->${w2}`)

// 会话引导视图
await ev(`(() => { const b = [...document.querySelectorAll('aside button')].find(x => x.innerText.trim() === '会话'); b?.click(); return 'ok' })()`)
await wait(500)
check('会话引导视图（无重复会话列表）', await ev(`document.body.innerText.includes('会话记录由 DeepSeek Harness 统一管理')`))
check('开始对话按钮', await ev(`[...document.querySelectorAll('aside button')].some(b => b.innerText.includes('开始对话'))`))

ws.close()
process.exit(0)
