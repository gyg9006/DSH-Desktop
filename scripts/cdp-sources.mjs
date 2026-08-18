/** 验证：数据源去重后应为 2 个（$DSH_HOME/~/.dsh 合并 + 工作文件夹）。 */
const list = await fetch('http://127.0.0.1:9222/json').then((r) => r.json())
const page = list.find((t) => t.type === 'page' && t.url.includes('index.html'))
if (!page) throw new Error('未找到应用页面')
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((resolve, reject) => {
  ws.onopen = resolve
  ws.onerror = () => reject(new Error('ws error'))
})
let id = 0
function ev(expression) {
  return new Promise((resolve) => {
    const my = ++id
    const handler = (e) => {
      const m = JSON.parse(e.data)
      if (m.id === my) {
        ws.removeEventListener('message', handler)
        resolve(m.result?.result?.value ?? '')
      }
    }
    ws.addEventListener('message', handler)
    ws.send(JSON.stringify({ id: my, method: 'Runtime.evaluate', params: { expression, returnByValue: true } }))
  })
}
await ev(`(document.querySelectorAll('aside button')[2]).click(); 'ok'`)
await new Promise((r) => setTimeout(r, 800))
await ev(`(() => { const t = [...document.querySelectorAll('.settings-dialog nav button')].find(b => b.innerText.includes('工作文件夹')); if (t) t.click(); return 'ok'; })()`)
await new Promise((r) => setTimeout(r, 500))
await ev(`(() => { const b = [...document.querySelectorAll('button')].find(b => b.innerText.includes('扫描本机数据')); if (b) b.click(); return 'ok'; })()`)
await new Promise((r) => setTimeout(r, 2500))
console.log(
  'SOURCE_CHECK',
  await ev(`JSON.stringify([...document.querySelectorAll('.settings-dialog .el-radio')].map(r => r.innerText.trim().split('\\n')[0]))`)
)
ws.close()
process.exit(0)
