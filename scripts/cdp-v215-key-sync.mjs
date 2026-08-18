/** v2.1.5 修复验证：输入 Key → 自动启用厂商 → models/credentials/settings 同步 → 启动服务。 */
const port = process.argv[2] ?? '9227'
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
// 1. 模拟用户输入 deepseek key（假 key，仅验证同步链路）
console.log('KEY_SAVE:', await ev(`window.dshw.modelsKeySave('deepseek', 'sk-test-1234567890abcdef').then(r => JSON.stringify(r)).catch(e => 'ERR ' + String(e))`))
// 2. 读取同步结果（通过 modelsGet 视图）
console.log('MODELS_VIEW:', await ev(`window.dshw.modelsGet().then(v => JSON.stringify({ presets: v.presets.length, masks: Object.keys(v.keyMasks) })).catch(e => 'ERR ' + String(e))`))
// 3. 启动服务（内置 dsh 自动启用/已启用）
console.log('START_SVC:', await ev(`window.dshw.startService().then(r => JSON.stringify(r)).catch(e => 'ERR ' + String(e))`))
ws.close()
process.exit(0)
