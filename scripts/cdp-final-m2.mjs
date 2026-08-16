/** M2 收尾验证：欢迎页环境灯 + 剪贴板 IPC + 「一键安装全部缺失项」禁用态。 */
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

// 1. 欢迎页环境灯（5 环境应全绿，侧栏服务灯灰）
console.log(
  '欢迎页:',
  await ev(`JSON.stringify({
    dots: [...document.querySelectorAll('.status-dot')].map(d => d.className.replace('status-dot ', '')),
    hasEnvSummary: document.body.innerText.includes('环境状态摘要')
  })`)
)

// 2. 剪贴板 IPC
console.log('写剪贴板:', await ev(`window.dshw.writeClipboard('dshw-clipboard-test-2026').then(r => JSON.stringify(r))`))

// 3. 打开设置 → 「一键安装全部缺失项」应禁用（全部就绪）
await ev(`(document.querySelectorAll('aside button')[2]).click(); 'ok'`)
await new Promise((r) => setTimeout(r, 800))
console.log(
  '全部按钮:',
  await ev(`JSON.stringify({
    installAllDisabled: [...document.querySelectorAll('.settings-dialog button')].find(b => b.innerText.includes('一键安装全部缺失项'))?.disabled ?? null,
    updateAllDisabled: [...document.querySelectorAll('.settings-dialog button')].find(b => b.innerText.includes('一键更新全部'))?.disabled ?? null,
    chips: [...document.querySelectorAll('.settings-dialog .status-chip')].map(c => c.innerText.trim()),
    sourceChips: [...document.querySelectorAll('.settings-dialog .source-chip')].map(c => c.innerText.trim())
  })`)
)
ws.close()
process.exit(0)
