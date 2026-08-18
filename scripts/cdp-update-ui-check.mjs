// P4 更新 UI 运行时检查：挂载无错误、关于页含「检查更新」，点击后走错误 Toast（GitHub 不可达）
const PORT = 9222
const errors = []
const page = await (async () => {
  const deadline = Date.now() + 20000
  while (Date.now() < deadline) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()
      const p = targets.find((t) => t.type === 'page' && /index\.html/.test(t.url ?? ''))
      if (p) return p
    } catch { /* not ready */ }
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error('CDP 超时')
})()
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws failed')) })
let seq = 0
const pend = new Map()
ws.onmessage = (e) => {
  const m = JSON.parse(e.data)
  if (m.id && pend.has(m.id)) { const { res, rej } = pend.get(m.id); pend.delete(m.id); m.error ? rej(new Error(m.error.message)) : res(m.result) }
  else if (m.method === 'Runtime.exceptionThrown') errors.push(`[异常] ${m.params.exceptionDetails?.exception?.description ?? ''}`)
  else if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') errors.push(`[console.error] ${m.params.entry.text}`)
}
const send = (method, params = {}) => new Promise((res, rej) => { const i = ++seq; pend.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })) })
const ev = async (x) => (await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true })).result?.value
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const clickText = async (t) => { const ok = await ev(`(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes(${JSON.stringify(t)})); if (!b) return false; b.click(); return true })()`); if (!ok) console.log(`  [click] 未找到「${t}」`); return ok }
const waitForText = async (t, ms = 15000) => { const d = Date.now() + ms; while (Date.now() < d) { if (await ev(`document.body.innerText.includes(${JSON.stringify(t)})`)) return true; await sleep(400) } return false }

await send('Runtime.enable')
await send('Log.enable')
await sleep(1500)

// 主界面（workbench）下 UpdateCenter 已挂载且无渲染错误
const booted = await ev(`document.body.innerText.includes('核心工作台')`)
console.log(`[1] 主界面渲染：${booted ? '✅' : '❌'}`)

await clickText('设置'); await sleep(500)
await clickText('关于'); await sleep(700)
const hasCheck = await ev(`[...document.querySelectorAll('button')].some((b) => b.textContent.includes('检查更新'))`)
console.log(`[1] 关于页 [检查更新] 按钮：${hasCheck ? '✅' : '❌'}`)

await clickText('检查更新')
const toastOrResult = await waitForText('已是最新版本', 20000) || await waitForText('检查更新失败', 20000) || await waitForText('发现新版本', 20000)
console.log(`[2] 点击检查 → 结果/错误 Toast 出现（GitHub 不可达时为错误提示）：${toastOrResult ? '✅' : '❌'}`)

console.log(`[3] 渲染层错误/异常：${errors.length === 0 ? '✅ 无' : '❌ ' + errors.join(' | ')}`)
ws.close()
process.exit(0)
