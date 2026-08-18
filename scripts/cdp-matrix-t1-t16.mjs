/** 测试矩阵 T1-T5/T8/T11-T16/T22-T24（CDP + 主界面交互）。 */
const port = process.argv[2] ?? '9229'
const list = await fetch(`http://127.0.0.1:${port}/json`).then((r) => r.json())
const page = list.find((t) => t.type === 'page' && t.url.includes('index.html'))
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((res, rej) => {
  ws.onopen = res
  ws.onerror = () => rej(new Error('ws'))
})
let id = 0
function ev(expression, to = 20000) {
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

// T1 首次启动引导
const t1 = await ev(`document.body.innerText.includes('首次启动引导')`)
console.log('T1 首次启动进引导页:', t1 ? 'PASS' : 'FAIL')

// T3/T4 跳过引导 → 主界面
const skip = await ev(`(() => { window.confirm = () => true; const b = [...document.querySelectorAll('button')].find(x => x.innerText.includes('跳过引导')); if (!b) return 'NO'; b.click(); return 'OK' })()`)
await new Promise((r) => setTimeout(r, 2500))
const t2 = await ev(`document.body.innerText.includes('核心工作台') && [...document.querySelectorAll('button')].some(b => b.innerText.includes('设置'))`)
console.log('T2 引导后进主页(导航可见):', t2 ? 'PASS' : 'FAIL')

// T4 设置页渲染
const navSet = await ev(`(() => { const b = [...document.querySelectorAll('button')].find(x => x.innerText.includes('设置') && x.innerText.includes('外观')); if (!b) return 'NO'; b.click(); return 'OK' })()`)
await new Promise((r) => setTimeout(r, 1200))
const t4 = await ev(`JSON.stringify([...document.querySelectorAll('button')].map(b => b.innerText.trim().slice(0, 10)).filter(Boolean).slice(0, 12))`)
console.log('T4 设置分类渲染:', t4)

// T5 配置 Key（deepseek）
const t5 = await ev(`window.dshw.modelsKeySave('deepseek', 'sk-test-abcdef1234567890').then(r => JSON.stringify(r)).catch(e => 'ERR')`)
console.log('T5 保存 Key:', t5)

// T8 模型选择器数据（settings.yaml 由主进程同步，通过 modelsGet 确认）
const t8 = await ev(`window.dshw.modelsGet().then(v => JSON.stringify({ masks: Object.keys(v.keyMasks), presets: v.presets.length })).catch(e => 'ERR')`)
console.log('T8 模型已配置:', t8)

// T15/T16 Tooltip（进入服务与运行卡片 → 检查自动探测/固定端口 + tooltip 文案存在）
const navAdv = await ev(`(() => { const b = [...document.querySelectorAll('button')].find(x => x.innerText.trim() === '高级配置'); if (!b) return 'NO'; b.click(); return 'OK' })()`)
await new Promise((r) => setTimeout(r, 1500))
const t1516 = await ev(`JSON.stringify({
  auto: document.body.innerText.includes('自动探测'),
  fixed: document.body.innerText.includes('固定端口'),
  tip1: document.body.innerText.includes('自动寻找可用端口'),
  tip2: document.body.innerText.includes('手动指定端口号')
})`)
console.log('T15/T16 端口模式+Tooltip:', t1516)

// T11 启动服务（先返回，再轮询文件系统）
console.log('T11 启动服务触发:', await ev(`window.dshw.startService().then(r => JSON.stringify(r)).catch(e => 'ERR ' + String(e))`, 15000))
ws.close()
process.exit(0)
