/** v2.1.9 全量测试矩阵（T1/T2/T5/T8/T11/T15/T16/重新引导入口）。 */
const port = process.argv[2] ?? '9251'
const list = await fetch(`http://127.0.0.1:${port}/json`).then((r) => r.json())
const page = list.find((t) => t.type === 'page' && t.url.includes('index.html'))
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((res, rej) => {
  ws.onopen = res
  ws.onerror = () => rej(new Error('ws'))
})
let id = 0
function ev(expression, to = 30000) {
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
// T1 首次引导
console.log('T1 引导页:', await ev(`document.body.innerText.includes('首次启动引导')`))
// T2 跳过 → 主页
console.log('跳过:', await ev(`(() => { window.confirm = () => true; const b = [...document.querySelectorAll('button')].find(x => x.innerText.includes('跳过引导')); if (!b) return 'NO'; b.click(); return 'OK' })()`))
await new Promise((r) => setTimeout(r, 2500))
console.log('T2 主页导航:', await ev(`document.body.innerText.includes('核心工作台') && [...document.querySelectorAll('button')].some(b => b.innerText.includes('设置'))`))
// T5 Key 保存
console.log('T5 保存Key:', await ev(`window.dshw.modelsKeySave('deepseek', 'sk-test-abcdef1234567890').then(r => JSON.stringify(r)).catch(e => 'ERR')`))
// T8 模型配置
console.log('T8 模型:', await ev(`window.dshw.modelsGet().then(v => JSON.stringify({ masks: Object.keys(v.keyMasks) })).catch(e => 'ERR')`))
// 重新引导入口（设置 → 通用）
console.log('导航设置:', await ev(`(() => { const b = [...document.querySelectorAll('button')].find(x => x.innerText.includes('设置') && x.innerText.includes('外观')); if (!b) return 'NO'; b.click(); return 'OK' })()`))
await new Promise((r) => setTimeout(r, 1200))
console.log('点击通用:', await ev(`(() => { const b = [...document.querySelectorAll('button')].find(x => x.innerText.trim() === '通用'); if (!b) return 'NO'; b.click(); return 'OK' })()`))
await new Promise((r) => setTimeout(r, 1200))
console.log('T 重新体验引导按钮:', await ev(`document.body.innerText.includes('重新体验引导')`))
// T11 启动服务
console.log('T11 启动服务:', await ev(`window.dshw.startService().then(r => JSON.stringify(r)).catch(e => 'ERR ' + String(e))`, 20000))
ws.close()
process.exit(0)
