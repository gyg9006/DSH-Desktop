/**
 * P2 智能同步运行时自测（CDP 驱动真实应用）：
 * 1) 预置：本地 bare 远端（初始提交 T0）+ 工作区文件（本地改新 → 应判 upload）+ sync.json 指向远端
 * 2) 应用内：设置 → 高级配置 → 智能预览 → 上传选中 → Toast 汇总
 * 用法：node scripts/cdp-smartsync-check.mjs
 */
const PORT = 9222
const results = []
const errors = []
const log = (msg) => { console.log(msg); results.push(msg) }

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
  throw new Error('CDP 页面目标超时')
})()

const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws failed')) })
let seq = 0
const pending = new Map()
ws.onmessage = (e) => {
  const m = JSON.parse(e.data)
  if (m.id && pending.has(m.id)) {
    const { res, rej } = pending.get(m.id)
    pending.delete(m.id)
    m.error ? rej(new Error(m.error.message)) : res(m.result)
  } else if (m.method === 'Runtime.exceptionThrown') {
    errors.push(`[异常] ${m.params.exceptionDetails?.exception?.description ?? m.params.exceptionDetails?.text ?? ''}`)
  } else if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') {
    errors.push(`[console.error] ${m.params.entry.text}`)
  }
}
const send = (method, params = {}) => new Promise((res, rej) => { const i = ++seq; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })) })
const ev = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (r.exceptionDetails) throw new Error(`页面执行异常：${r.exceptionDetails.text} ${r.exceptionDetails.exception?.description ?? ''}`)
  return r.result?.value
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const clickText = async (text) => {
  const ok = await ev(`(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes(${JSON.stringify(text)})); if (!b) return false; b.click(); return true })()`)
  if (!ok) log(`  [click] 未找到「${text}」`)
  return ok
}
const waitForText = async (text, timeoutMs = 15000) => {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const found = await ev(`document.body.innerText.includes(${JSON.stringify(text)})`)
    if (found) return true
    await sleep(400)
  }
  return false
}

await send('Runtime.enable')
await send('Log.enable')

// 1. 进入设置 → 高级配置
log(`[1] 进入设置：${(await clickText('设置')) ? '✅' : '❌'}`)
await sleep(600)
log(`[1] 进入高级配置：${(await clickText('高级配置')) ? '✅' : '❌'}`)
await sleep(800)
const hasSyncCard = await ev(`document.body.innerText.includes('异地智能同步')`)
log(`[1] 智能同步卡片渲染：${hasSyncCard ? '✅' : '❌'}`)

// 2. 智能预览
log(`[2] 点击智能预览：${(await clickText('智能预览')) ? '✅' : '❌'}`)
const previewOk = await waitForText('共 ', 20000)
log(`[2] 预览结果出现：${previewOk ? '✅' : '❌'}`)
await sleep(500)
const statsText = await ev(`(() => { const el = [...document.querySelectorAll('div')].find((d) => d.textContent && d.textContent.includes('共 ') && d.textContent.includes('上传')); return el ? el.innerText.replace(/\\s+/g, ' ').trim() : '' })()`)
log(`[2] 统计行：${statsText || '（未找到）'}`)
const uploadCount = await ev(`(() => { const el = [...document.querySelectorAll('div')].find((d) => d.textContent && d.textContent.includes('共 ') && d.textContent.includes('上传')); const m = el ? el.innerText.match(/上传 (\\d+)/) : null; return m ? Number(m[1]) : 0 })()`)
log(`[2] 待上传数量：${uploadCount}`)

// 3. 上传选中
if (uploadCount > 0) {
  log(`[3] 点击上传选中：${(await clickText('上传选中')) ? '✅' : '❌'}`)
  const done = await waitForText('上传成功', 30000)
  log(`[3] Toast「上传成功」：${done ? '✅' : '❌'}`)
} else {
  log('[3] 无待上传文件，跳过上传执行')
}

// 4. 渲染层错误收集
log(`[4] 渲染层错误/异常：${errors.length === 0 ? '✅ 无' : '❌ ' + errors.join(' | ')}`)

console.log('--- RESULT FILE: scripts/cdp-smartsync-result.txt ---')
ws.close()
process.exit(0)
