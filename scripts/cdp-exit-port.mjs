/** 验证：端口被占自动顺延（fixed 模式）+ 关闭窗口真正退出（无残留进程）。 */
const list = await fetch('http://127.0.0.1:9222/json').then((r) => r.json())
const page = list.find((t) => t.type === 'page' && t.url.includes('index.html'))
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((r) => (ws.onopen = r))
let id = 0
function ev(expression, timeout = 30000) {
  return new Promise((resolve, reject) => {
    const my = ++id
    const timer = setTimeout(() => reject(new Error('timeout')), timeout)
    const handler = (e) => {
      const m = JSON.parse(e.data)
      if (m.id === my) { clearTimeout(timer); ws.removeEventListener('message', handler); resolve(m.result?.result?.value) }
    }
    ws.addEventListener('message', handler)
    ws.send(JSON.stringify({ id: my, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true } }))
  })
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

// 1. 端口顺延：fixed 3080（被外部 dsh 占用）→ 应顺延到 3081+
await ev(`window.dshw.updateConfig({ service: { portMode: 'fixed', port: 3080 } })`)
await wait(400)
const start = await ev(`window.dshw.startService().then(r => JSON.stringify(r))`)
console.log('fixed 3080 启动结果:', start)
const sr = JSON.parse(start)
console.log(sr.ok ? '  ✅ 端口被占自动顺延启动成功（端口见快照）' : '  ❌ 启动失败：' + sr.error)
const snap = await ev(`window.dshw.getServiceStatus().then(s => JSON.stringify({ status: s.status, port: s.port }))`)
console.log('服务快照:', snap, JSON.parse(snap).port !== 3080 ? '✅ 端口已顺延' : '❌ 端口未顺延')
await ev(`window.dshw.stopService()`)
await wait(2000)

// 2. 关闭窗口 = 真正退出
console.log('触发关闭窗口（windowClose）…')
await ev(`window.dshw.windowClose()`).catch(() => 'closed')
await wait(6000)
// CDP 应断连
try {
  await fetch('http://127.0.0.1:9222/json', { signal: AbortSignal.timeout(2000) })
  console.log('  ❌ CDP 仍在线（应用未退出）')
} catch {
  console.log('  ✅ CDP 已断连（应用已退出）')
}
process.exit(0)
