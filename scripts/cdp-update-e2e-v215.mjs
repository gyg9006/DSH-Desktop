/** 更新保护机制 e2e：check → download → applyUpdate（冒烟+报告）。 */
const port = process.argv[2] ?? '9231'
const list = await fetch(`http://127.0.0.1:${port}/json`).then((r) => r.json())
const page = list.find((t) => t.type === 'page' && t.url.includes('index.html'))
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((res, rej) => {
  ws.onopen = res
  ws.onerror = () => rej(new Error('ws'))
})
let id = 0
function ev(expression, to = 180000) {
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
// 1. 检查更新（force）
const check = await ev(`window.dshw.checkUpdate(true).then(r => JSON.stringify({ hasUpdate: r.hasUpdate, version: r.latest, assetId: r.assetId, assetName: r.assetName, size: r.size })).catch(e => 'ERR ' + String(e))`, 60000)
console.log('CHECK:', check)
// 2. 下载 + 3. 应用（applyUpdate → 冒烟 + update-report；字段为 path）
const ap = await ev(`window.dshw.checkUpdate(true).then(r => { if (!r.hasUpdate || !r.assetId) return 'NO_ASSET'; return window.dshw.downloadUpdate(r.assetId).then(d => { if (!d.ok) return 'DL_FAIL:' + (d.error || ''); return window.dshw.applyUpdate(d.path).then(a => JSON.stringify({ downloadOk: d.ok, applyOk: a.ok, error: a.error })).catch(e => 'APPLY_ERR ' + String(e)) }).catch(e => 'DL_ERR ' + String(e)) }).catch(e => 'CHECK_ERR ' + String(e))`, 240000)
console.log('APPLY:', ap)
ws.close()
process.exit(0)
