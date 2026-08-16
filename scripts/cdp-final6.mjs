/** 最终验证：侧边栏设置子项/服务启停/导入按钮 + 真实同步 push/pull。 */
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
function ev(expression, timeout = 20000) {
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
const clickByText = (text) =>
  ev(`(() => { const btn = [...document.querySelectorAll('button')].find(b => b.innerText.trim().includes(${JSON.stringify(text)})); if (!btn || btn.disabled) return 'NOT_FOUND'; btn.click(); return 'clicked'; })()`)
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

// 完成向导
await clickByText('下一步')
await wait(800)
await clickByText('跳过')
await wait(800)
await clickByText('完成，开始使用')
await wait(1500)

// 1. 侧边栏导航（会话/设置子项）
console.log('导航:', await ev(`JSON.stringify([...document.querySelectorAll('aside button')].map(b => b.innerText.trim()).filter(t => t === '会话' || t === '设置'))`))

// 2. 切到设置子项 → 服务启停 + 设置项
await ev(`(() => { const b = [...document.querySelectorAll('aside button')].find(b => b.innerText.trim() === '设置'); if (b) b.click(); return 'ok'; })()`)
await wait(500)
console.log('设置面板:', await ev(`JSON.stringify({
  serviceBtn: [...document.querySelectorAll('aside button')].some(b => b.innerText.includes('启动') || b.innerText.includes('停止')),
  envItem: [...document.querySelectorAll('aside button')].some(b => b.innerText.includes('环境检测')),
  syncItem: [...document.querySelectorAll('aside button')].some(b => b.innerText.includes('异地同步')),
  resetItem: [...document.querySelectorAll('aside button')].some(b => b.innerText.includes('日志与关于'))
})`))

// 3. 设置面板启动服务
console.log('面板启停:', await clickByText('启动'))
let running = false
for (let i = 0; i < 60; i++) {
  await wait(3000)
  const st = await ev(`(() => { const d = [...document.querySelectorAll('.status-dot')].find(x => x.closest('aside')); return d ? d.className.replace('status-dot status-dot--', '') : 'none'; })()`)
  if (st === 'running') { running = true; break }
}
console.log('服务运行:', running)

// 4. 真实同步：push 本地 → 远端，再 pull 回来
console.log('SYNC_PUSH:', await ev(`window.dshw.syncPush().then(r => JSON.stringify(r))`))
console.log('SYNC_PULL:', await ev(`window.dshw.syncPull().then(r => JSON.stringify(r))`))
console.log('SYNC_CFG:', await ev(`window.dshw.getSyncConfig().then(r => JSON.stringify({ counts: r.counts, lastSyncAt: r.config.lastSyncAt }))`))

// 5. 回会话视图，验证导入按钮存在
await ev(`(() => { const b = [...document.querySelectorAll('aside button')].find(b => b.innerText.trim() === '会话'); if (b) b.click(); return 'ok'; })()`)
await wait(400)
console.log('导入按钮:', await ev(`!!document.querySelector('aside button[aria-label="导入会话"]')`))
ws.close()
process.exit(0)
