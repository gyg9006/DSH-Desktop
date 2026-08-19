/** fresh v2.1.10 smoke: onboarding/title/default model/service. */
const port = process.argv[2] ?? '9253'
const list = await fetch(`http://127.0.0.1:${port}/json`).then((r) => r.json())
const page = list.find((t) => t.type === 'page' && t.url.includes('index.html'))
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = () => reject(new Error('websocket')) })
let id = 0
function ev(expression, timeout = 30000) {
  return new Promise((resolve) => {
    const current = ++id
    const timer = setTimeout(() => { ws.removeEventListener('message', handler); resolve('TIMEOUT') }, timeout)
    const handler = (event) => {
      const msg = JSON.parse(event.data)
      if (msg.id === current) {
        clearTimeout(timer)
        ws.removeEventListener('message', handler)
        resolve(msg.result?.result?.value ?? JSON.stringify(msg.result?.exceptionDetails ?? ''))
      }
    }
    ws.addEventListener('message', handler)
    ws.send(JSON.stringify({ id: current, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true } }))
  })
}
console.log('T1 onboarding:', await ev(`document.body.innerText.includes('首次启动引导')`))
console.log('T4 title:', await ev('document.title'))
console.log('T1 skip:', await ev(`(() => { window.confirm = () => true; const b=[...document.querySelectorAll('button')].find(x=>x.innerText.includes('跳过引导')); if(!b)return 'NO'; b.click(); return 'OK' })()`))
await new Promise((r) => setTimeout(r, 2000))
console.log('T2 home/navigation:', await ev(`JSON.stringify({home:document.body.innerText.includes('核心工作台'), nav:[...document.querySelectorAll('button')].filter(x=>x.innerText.includes('设置')).length})`))
console.log('T3 default model sync:', await ev(`window.dshw.modelsGet().then(v=>JSON.stringify({presets:v.presets.length, masks:Object.keys(v.keyMasks)}))`))
console.log('T11 start service:', await ev(`window.dshw.startService().then(r=>JSON.stringify(r)).catch(e=>'ERR '+String(e))`, 20000))
ws.close()
process.exit(0)
