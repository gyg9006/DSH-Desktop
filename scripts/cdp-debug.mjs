/** 多模式验证：collapse（收起）/ restore（重启恢复宽度）/ dialog（设置弹窗）。 */
const DEBUG_PORT = 9222
const mode = process.argv[2] ?? 'dialog'

const list = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json`).then((r) => r.json())
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
        resolve(m.result?.result?.value ?? JSON.stringify(m.result?.exceptionDetails ?? ''))
      }
    }
    ws.addEventListener('message', handler)
    ws.send(JSON.stringify({ id: my, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true } }))
  })
}

const width = () => ev(`document.querySelector('aside').getBoundingClientRect().width`)

if (mode === 'collapse') {
  // 展开态按钮：[0]新建 [1]启动 [2]设置 [3]主题 [4]收起 —— 点击 [4] 收起
  const w0 = await width()
  await ev(`(document.querySelectorAll('aside button')[4]).click(); 'ok'`)
  await new Promise((r) => setTimeout(r, 600))
  console.log(`COLLAPSE_CHECK {"before":${w0},"after":${await width()}}`)
} else if (mode === 'restore') {
  console.log(`RESTORE_CHECK {"width":${await width()}}`)
} else {
  // 展开态点击 [2] = 设置
  await ev(`(document.querySelectorAll('aside button')[2]).click(); 'ok'`)
  await new Promise((r) => setTimeout(r, 500))
  console.log(
    'DIALOG_CHECK ' +
      (await ev(`JSON.stringify({
        overlayVisible: !!document.querySelector('.el-overlay') && getComputedStyle(document.querySelector('.el-overlay')).display !== 'none',
        dialogClass: document.querySelector('.settings-dialog')?.className ?? null,
        tabCount: document.querySelectorAll('.settings-dialog nav button').length,
        tabNames: [...document.querySelectorAll('.settings-dialog nav button')].map(b => b.innerText.trim()),
        activeTabTitle: document.querySelector('.settings-dialog h3')?.innerText ?? null
      })`))
  )
}
ws.close()
process.exit(0)
