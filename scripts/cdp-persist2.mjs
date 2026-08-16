/** 验证：完成向导后磁盘 app.json 内容 + 重启后环境检测五项。 */
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
function ev(expression, timeout = 12000) {
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
  ev(`(() => { const btn = [...document.querySelectorAll('button')].find(b => b.innerText.trim().includes(${JSON.stringify(text)})); if (!btn || btn.disabled) return 'NOT_FOUND'; btn.click(); return 'clicked'; })()`)
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

const mode = process.argv[2] ?? 'wizard'
if (mode === 'wizard') {
  await clickByText('下一步')
  await wait(800)
  await clickByText('跳过')
  await wait(800)
  await clickByText('完成，开始使用')
  await wait(2000)
  console.log('RESULT:', await ev(`window.dshw.updateConfig({ onboarded: true }).then(r => JSON.stringify(r))`))
  console.log('CONFIG_NOW:', await ev(`window.dshw.getConfig().then(c => JSON.stringify(c))`))
} else {
  const env = await ev(`window.dshw.detectEnv().then(r => JSON.stringify(r.items.map(i => ({ k: i.key, s: i.state, v: i.version }))))`)
  console.log('ENV:', env)
  console.log('CONFIG:', await ev(`window.dshw.getConfig().then(c => JSON.stringify(c))`))
}
ws.close()
process.exit(0)
