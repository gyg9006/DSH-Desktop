/** 测试 1：端口模式保存（自动探测/固定端口）；测试 2：系统 dsh 启动。 */
const port = process.argv[2] ?? '9238'
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

// ---- 测试 1a：固定端口保存 ----
const setFixed = await ev(`window.dshw.updateConfig({ service: { portMode: 'fixed', port: 39999 } }).then(() => window.dshw.getConfig()).then(c => JSON.stringify({ portMode: c.service.portMode, port: c.service.port })).catch(e => 'ERR ' + String(e))`)
console.log('T1a 保存固定端口 39999:', setFixed)

// ---- 测试 1b：自动探测保存 ----
const setAuto = await ev(`window.dshw.updateConfig({ service: { portMode: 'auto', port: undefined } }).then(() => window.dshw.getConfig()).then(c => JSON.stringify({ portMode: c.service.portMode, port: c.service.port })).catch(e => 'ERR ' + String(e))`)
console.log('T1b 保存自动探测:', setAuto)

// ---- 测试 2：系统 dsh ----
// 2a. 设置 useSystemDsh
const setSys = await ev(`window.dshw.updateConfig({ service: { useSystemDsh: true } }).then(() => window.dshw.getConfig()).then(c => JSON.stringify({ useSystemDsh: c.service.useSystemDsh })).catch(e => 'ERR ' + String(e))`)
console.log('T2a 设置 useSystemDsh:', setSys)
// 2b. 启动服务（系统 dsh）
console.log('T2b 启动服务(系统dsh):', await ev(`window.dshw.startService().then(r => JSON.stringify(r)).catch(e => 'ERR ' + String(e))`, 25000))
ws.close()
process.exit(0)
