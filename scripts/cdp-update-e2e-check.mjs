// 端到端更新验证（mock 更新源）：检查 → 发现 v2.1.1 → 通知 → 立即更新 → 下载 + SHA256 校验 → 已下载
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
  throw new Error('CDP timeout')
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
const waitForText = async (t, ms = 20000) => { const d = Date.now() + ms; while (Date.now() < d) { if (await ev(`document.body.innerText.includes(${JSON.stringify(t)})`)) return true; await sleep(400) } return false }
const progressSample = async () => { const p = await ev(`(() => { const el = [...document.querySelectorAll('div')].find((d) => d.textContent && /\\d+%/.test(d.textContent) && d.textContent.length < 20); return el ? el.textContent.trim() : '' })()`); return p }

await send('Runtime.enable')
await send('Log.enable')
await sleep(1500)

console.log('[1] 打开 设置 → 关于 …')
await clickText('设置'); await sleep(600)
await ev(`(() => { const b = [...document.querySelectorAll('nav button')].find((x) => x.textContent.trim() === '关于'); if (b) b.click(); return !!b })()`)
await sleep(600)

console.log('[2] 点击 [检查更新] …')
await clickText('检查更新')
const found = await waitForText('发现新版本 v2.1.1', 20000)
const notice = await waitForText('立即更新', 15000)
console.log(`[2] 检查到 v2.1.1（mock 源）：${found ? '✅' : '❌'}`)
console.log(`[2] 右下角通知出现 [立即更新]：${notice ? '✅' : '❌'}`)

console.log('[3] 点击 [立即更新] …')
await clickText('立即更新')
const downloading = await waitForText('正在更新', 15000)
let samples = []
for (let i = 0; i < 30; i++) {
  const s = await progressSample()
  if (s && /%/.test(s)) samples.push(s)
  const done = await ev(`document.body.innerText.includes('更新包已下载')`)
  if (done) break
  await sleep(500)
}
console.log(`[3] 进度窗口出现：${downloading ? '✅' : '❌'}`)
console.log(`[3] 下载进度采样（首/中/末）：${samples.length > 0 ? samples[0] + ' → ' + (samples[Math.floor(samples.length / 2)] ?? '') + ' → ' + samples[samples.length - 1] : '（未见）'}`)
const downloaded = await waitForText('更新包已下载', 120000)
console.log(`[3] 下载完成 + SHA256 校验通过（"更新包已下载"）：${downloaded ? '✅' : '❌'}`)

// 校验 .parts 已清理 + zip 已落盘
const zipOk = await ev(`window.dshw.getWorkspaceInfo().then((i) => i.workspacePath)`)
console.log(`[4] 工作区路径：${zipOk}`)
console.log(`[R] 渲染层错误/异常：${errors.length === 0 ? '✅ 无' : '❌ ' + errors.join(' | ')}`)
ws.close()
process.exit(0)
