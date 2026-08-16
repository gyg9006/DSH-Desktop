/** M3 迁移复验：扫描（含嵌套会话）→ 预检 → 迁移 → 完成。 */
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

// 打开设置 → 工作文件夹 Tab
await ev(`(document.querySelectorAll('aside button')[2]).click(); 'ok'`)
await wait(800)
await ev(`(() => { const tab = [...document.querySelectorAll('.settings-dialog nav button')].find(b => b.innerText.includes('工作文件夹')); if (tab) tab.click(); return 'ok'; })()`)
await wait(500)

// 扫描
console.log('扫描:', await clickByText('扫描本机数据'))
await wait(2500)
console.log('数据源:', await ev(`JSON.stringify([...document.querySelectorAll('.settings-dialog .el-radio')].map(r => r.innerText.trim().split('\\n')[0]).filter(Boolean))`))
// 检查会话项是否被勾选（嵌套会话计数）
console.log('勾选项:', await ev(`JSON.stringify([...document.querySelectorAll('.settings-dialog .el-checkbox')].filter(c => !c.className.includes('is-disabled')).map(c => c.innerText.trim().split('\\n')[0]))`))

// 预检 + 迁移
console.log('预检:', await clickByText('预检迁移计划'))
await wait(1200)
console.log('预检文件数:', await ev(`(() => { const m = document.body.innerText.match(/(\\d+) 个文件/); return m ? m[1] : 'N/A'; })()`))
console.log('开始迁移:', await clickByText('开始迁移'))

let final = null
for (let i = 0; i < 40; i++) {
  await wait(3000)
  const state = await ev(`(() => {
    const chips = [...document.querySelectorAll('.status-chip')].map(c => c.innerText.trim());
    const status = chips.find(c => ['完成','失败','已取消','进行中'].includes(c));
    const logs = [...document.querySelectorAll('pre')].map(p => p.innerText).join('\\n');
    return JSON.stringify({ status: status ?? null, last: logs.split('\\n').filter(Boolean).slice(-1)[0] ?? '' });
  })()`)
  const parsed = JSON.parse(state)
  console.log(`[${(i + 1) * 3}s] status=${parsed.status} last=${parsed.last.slice(0, 80)}`)
  if (parsed.status === '完成' || parsed.status === '失败' || parsed.status === '已取消') {
    final = parsed
    break
  }
}
ws.close()
if (final?.status !== '完成') {
  console.log('MIGRATE2_FAIL status=' + (final?.status ?? 'timeout'))
  process.exit(1)
}
console.log('MIGRATE2_OK')
process.exit(0)
