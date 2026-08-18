/** 完整链路验证：跳过引导 → 点启动服务 → 自动启用内置 dsh → 服务运行。 */
const port = process.argv[2] ?? '9224'
const list = await fetch(`http://127.0.0.1:${port}/json`).then((r) => r.json())
const page = list.find((t) => t.type === 'page' && t.url.includes('index.html'))
if (!page) {
  console.log('NO_PAGE')
  process.exit(1)
}
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((res, rej) => {
  ws.onopen = res
  ws.onerror = () => rej(new Error('ws'))
})
let id = 0
function ev(expression, to = 12000) {
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

// 1. 引导页 → 跳过
const wiz = await ev(`JSON.stringify({ hasWizard: document.body.innerText.includes('首次启动引导'), skip: [...document.querySelectorAll('button')].filter(b=>b.innerText.includes('跳过引导')).length })`)
console.log('STEP1 wizard:', wiz)
if (wiz.includes('"hasWizard":true')) {
  const click = await ev(`(() => { window.confirm = () => true; const b = [...document.querySelectorAll('button')].find(x => x.innerText.includes('跳过引导')); if (!b) return 'NO_BTN'; b.click(); return 'CLICKED' })()`)
  console.log('STEP1 skip-click:', click)
  await new Promise((r) => setTimeout(r, 2500))
}
const main = await ev(`JSON.stringify({ isMain: document.body.innerText.includes('核心工作台'), hasStart: [...document.querySelectorAll('button')].filter(b=>b.innerText.includes('启动服务')).length })`)
console.log('STEP2 main:', main)

// 2. 点启动服务 → 自动启用内置 dsh → 服务运行（最多 4 分钟）
const start = await ev(`(() => { const b = [...document.querySelectorAll('button')].find(x => x.innerText.includes('启动服务')); if (!b) return 'NO_BTN'; b.click(); return 'CLICKED' })()`)
console.log('STEP3 start-click:', start)

let final = 'UNKNOWN'
for (let i = 0; i < 24; i++) {
  await new Promise((r) => setTimeout(r, 10000))
  const st = await ev('document.body.innerText.slice(-400)')
  const txt = typeof st === 'string' ? st : String(st)
  const isRun = txt.includes('服务运行中') || txt.includes('运行中 ·') || txt.includes('dsh web 就绪')
  const lines = txt.split('\n').filter(Boolean).slice(-4).join(' | ')
  console.log(`poll#${i + 1} run=${isRun} :: ${lines}`)
  if (isRun) {
    final = 'RUNNING'
    break
  }
}
console.log('FINAL:', final)
ws.close()
process.exit(0)
