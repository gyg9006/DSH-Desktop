/** T11-T16 专项复测（最终构建）：跳过 → Key → 启动服务 → Tooltip。 */
const port = process.argv[2] ?? '9230'
const list = await fetch(`http://127.0.0.1:${port}/json`).then((r) => r.json())
const page = list.find((t) => t.type === 'page' && t.url.includes('index.html'))
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((res, rej) => {
  ws.onopen = res
  ws.onerror = () => rej(new Error('ws'))
})
let id = 0
function ev(expression, to = 15000) {
  return new Promise((resolve) => {
    const my = ++id
    const t = setTimeout(() => {
      ws.removeEventListener('message', h)
      resolve('TIMEOUT')
    }, to)
    const h = (e) => {
      const m = JSON.parse(e.data)
      if (m.id === my) {
        clearTimeout(t)
        ws.removeEventListener('message', h)
        resolve(m.result?.result?.value ?? JSON.stringify(m.result?.exceptionDetails ?? ''))
      }
    }
    ws.addEventListener('message', h)
    ws.send(JSON.stringify({ id: my, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true } }))
  })
}
console.log('T1 引导:', await ev(`document.body.innerText.includes('首次启动引导')`))
console.log('跳过:', await ev(`(() => { window.confirm = () => true; const b = [...document.querySelectorAll('button')].find(x => x.innerText.includes('跳过引导')); if (!b) return 'NO'; b.click(); return 'OK' })()`))
await new Promise((r) => setTimeout(r, 2500))
console.log('T2 主页:', await ev(`document.body.innerText.includes('核心工作台')`))
console.log('T5 Key:', await ev(`window.dshw.modelsKeySave('deepseek', 'sk-test-abcdef1234567890').then(r => JSON.stringify(r)).catch(e => 'ERR')`))
console.log('T15/T16 Tooltip:', await ev(`(async () => {
  const find = (txt) => [...document.querySelectorAll('span, div, button')].find(e => e.children.length === 0 && e.textContent.trim() === txt)
  const nav = [...document.querySelectorAll('button')].find(b => b.innerText.includes('设置') && b.innerText.includes('外观'))
  nav && nav.click()
  await new Promise(r => setTimeout(r, 1200))
  const adv = [...document.querySelectorAll('button')].find(b => b.innerText.trim() === '高级配置')
  adv && adv.click()
  await new Promise(r => setTimeout(r, 1200))
  const auto = find('自动探测')
  if (!auto) return 'NO_AUTO'
  auto.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
  await new Promise(r => setTimeout(r, 450))
  const shown = document.body.innerText.includes('自动寻找可用端口')
  return JSON.stringify({ shown })
})()`))
console.log('T11 启动:', await ev(`window.dshw.startService().then(r => JSON.stringify(r)).catch(e => 'ERR ' + String(e))`, 20000))
ws.close()
process.exit(0)
