// P5+P6 UI 运行时检查 v3：nav 作用域点击
const targets = await (await fetch('http://127.0.0.1:9222/json')).json()
const page = targets.find((t) => t.type === 'page')
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((res) => (ws.onopen = res))
let id = 0
const pend = new Map()
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { const { res, rej } = pend.get(m.id); pend.delete(m.id); m.error ? rej(new Error(m.error.message)) : res(m.result) } else if (m.method === 'Runtime.exceptionThrown') errors.push(`[异常] ${m.params.exceptionDetails?.exception?.description ?? ''}`) }
const errors = []
const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pend.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })) })
const ev = async (x) => (await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true })).result?.value
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const clickSidebar = (t) => ev(`(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim().startsWith(${JSON.stringify(t)})); if (!b) return false; b.click(); return true })()`)
const clickNav = (t) => ev(`(() => { const b = [...document.querySelectorAll('nav button')].find((x) => x.textContent.trim() === ${JSON.stringify(t)}); if (!b) return false; b.click(); return true })()`)
const nav = () => ev(`([...document.querySelectorAll('nav button')].map((b) => (b.className.includes('nav-item-active') ? '★' : '') + b.textContent.trim()).join(','))`)
const waitForText = async (t, ms = 8000) => { const d = Date.now() + ms; while (Date.now() < d) { if (await ev(`document.body.innerText.includes(${JSON.stringify(t)})`)) return true; await sleep(400) } return false }

await send('Runtime.enable')
await sleep(1500)

// P5
console.log('click 设置:', await clickSidebar('设置'))
await sleep(800)
const hasWorkspace = await waitForText('工作文件夹', 6000)
console.log(`[P5] 工作文件夹卡片：${hasWorkspace ? '✅' : '❌'}`)
console.log(`[P5] 迁移按钮：${(await ev(`[...document.querySelectorAll('button')].some((b) => b.textContent.includes('更改位置并迁移'))`)) ? '✅' : '❌'}`)

// P6
console.log('click 外观:', await clickNav('外观'))
await sleep(800)
const hasBg = await waitForText('会话背景', 6000)
console.log(`[P6] 会话背景卡片：${hasBg ? '✅' : '❌'}`)
const clickedGrad = await ev(`(() => { const b = document.querySelector('button[title="深空蓝紫"]'); if (!b) return false; b.click(); return true })()`)
await sleep(1000)
const previewApplied = await ev(`(() => { const els = [...document.querySelectorAll('div')]; return !!els.find((d) => d.style && d.style.backgroundImage && d.style.backgroundImage.includes('linear-gradient')) })()`)
const saved = await waitForText('会话背景已保存', 6000)
const cfgBg = await ev(`window.dshw.getConfig().then((c) => JSON.stringify(c.sessionBackground))`)
console.log(`[P6] 渐变预设点击：${clickedGrad ? '✅' : '❌'}`)
console.log(`[P6] 预览应用渐变：${previewApplied ? '✅' : '❌'}`)
console.log(`[P6] 保存 Toast：${saved ? '✅' : '❌'}`)
console.log(`[P6] config.sessionBackground：${cfgBg}`)
console.log(`[R] 渲染层异常：${errors.length === 0 ? '✅ 无' : '❌ ' + errors.join(' | ')}`)
ws.close()
process.exit(0)
