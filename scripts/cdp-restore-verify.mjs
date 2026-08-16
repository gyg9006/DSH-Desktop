/** 验证恢复后的会话树 + dsh 服务启动。 */
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

check('主界面（无向导）', await ev(`!document.querySelector('.el-step') && !!document.querySelector('aside')`))
await ev(`(() => { const w = document.querySelector('aside').getBoundingClientRect().width; if (w < 200) { const b = document.querySelector('aside button[aria-label="收起或展开任务栏"]'); if (b) b.click(); } return 'ok' })()`)
await wait(800)
await ev(`(() => { const b = [...document.querySelectorAll('aside button')].find(x => x.innerText.includes('返回会话')); if (b) b.click(); return 'ok' })()`)
await wait(1500)
// 展开工作区节点（新启动默认折叠）
await ev(`(() => {
  const rows = [...document.querySelectorAll('aside div.group')].filter(r => r.textContent.includes('deepseek_workspace'))
  if (rows[0]) rows[0].click()
  return 'ok'
})()`)
await wait(1000)
const tree = await ev(`(() => {
  const aside = document.querySelector('aside')
  // 会话行 = 侧栏中 text-[11px] 的树节点（会话显示标题，不一定含 session- 前缀）
  const sessionRows = [...aside.querySelectorAll('div.group')].filter(d => /text-\\[11px\\]/.test(d.className || ''))
  return JSON.stringify({ hasWs: aside.innerText.indexOf('deepseek_workspace') >= 0, sessionCount: sessionRows.length, rows: sessionRows.map(r => r.innerText.replace(/\\n/g, ' | ').slice(0, 80)) })
})()`)
console.log('会话树:', tree)
const tr = JSON.parse(tree)
check('工作区树恢复（deepseek_workspace + 会话）', tr.hasWs === true && tr.sessionCount >= 1, tree)

await ev(`(() => { const btn = [...document.querySelectorAll('aside button')].find(b => b.innerText.includes('启动')); if (!btn) return 'NO'; btn.click(); return 'ok' })()`)
let status = ''
for (let i = 0; i < 60; i++) {
  await wait(2500)
  status = await ev(`(() => { const d = [...document.querySelectorAll('.status-dot')].find(x => x.closest('aside')); return d ? d.className.replace('status-dot status-dot--', '') : 'none'; })()`)
  if (status === 'running' || status === 'error') break
}
console.log('服务状态:', status)
check('dsh 服务可启动（运行时恢复成功）', status === 'running', status)
ws.close()
process.exit(0)
