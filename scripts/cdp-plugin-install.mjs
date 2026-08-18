/** 通过应用 IPC 安装插件（真实 pnpm add），验证在线安装链路。 */
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
function ev(expression, timeout = 300000) {
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

const spec = process.argv[2] ?? '@deepseek-ai/dsh-session-title-llm@0.0.1-rc.1'
const expr = `window.dshw.installPlugin(${JSON.stringify(spec)}).then(r => JSON.stringify({ ok: r.ok, error: r.error, bundle: r.bundle, tail: (r.log || '').split('\\n').slice(-5) }))`
console.log('installing', spec, '...')
console.log('RESULT:', await ev(expr, 300000))
ws.close()
process.exit(0)
