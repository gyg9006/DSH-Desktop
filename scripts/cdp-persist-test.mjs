/** 闭环验证：完成向导后重启，应直接进主界面且环境检测正常。 */
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
        resolve(m.result?.result?.value ?? '')
      }
    }
    ws.addEventListener('message', handler)
    ws.send(JSON.stringify({ id: my, method: 'Runtime.evaluate', params: { expression, returnByValue: true } }))
  })
}
const clickByText = (text) =>
  ev(`(() => { const btn = [...document.querySelectorAll('button')].find(b => b.innerText.trim().includes(${JSON.stringify(text)})); if (!btn || btn.disabled) return 'NOT_FOUND'; btn.click(); return 'clicked'; })()`)
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

const mode = process.argv[2] ?? 'wizard'
if (mode === 'wizard') {
  // 第 1 次启动：完成向导
  console.log('向导:', await ev(`!!document.querySelector('.el-step')`))
  await clickByText('下一步')
  await wait(800)
  await clickByText('跳过')
  await wait(800)
  await clickByText('完成，开始使用')
  await wait(1500)
  console.log('主界面:', await ev(`!!document.querySelector('aside')`))
  console.log('CONFIG:', await ev(`window.dshw.getConfig().then(c => JSON.stringify({ onboarded: c.onboarded, workspacePath: c.workspacePath }))`))
} else {
  // 第 2 次启动：应直接主界面，不进向导；环境检测正常
  const inWizard = await ev(`!!document.querySelector('.el-step')`)
  console.log('是否进向导:', inWizard ? '是（异常！）' : '否（正常）')
  const env = await ev(`window.dshw.detectEnv().then(r => JSON.stringify(r.items.map(i => i.key + ':' + i.state + ':' + (i.version ?? ''))))`)
  console.log('ENV:', env)
}
ws.close()
process.exit(0)
