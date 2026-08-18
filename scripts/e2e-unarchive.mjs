const list = await fetch('http://127.0.0.1:9222/json').then((r) => r.json())
const page = list.find((t) => t.type === 'page' && t.url.includes('index.html'))
if (!page) throw new Error('no page')
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; })
let id = 0
const ev = (expression, timeout = 30000) => new Promise((resolve) => {
  const my = ++id
  const t = setTimeout(() => { ws.removeEventListener('message', h); resolve('TIMEOUT') }, timeout)
  const h = (e) => { const m = JSON.parse(e.data); if (m.id === my) { clearTimeout(t); ws.removeEventListener('message', h); resolve(m.result?.result?.value ?? '') } }
  ws.addEventListener('message', h)
  ws.send(JSON.stringify({ id: my, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true } }))
})
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
// 1. 读取当前归档列表
const before = await ev(`window.dshw.getSidebarData().then(r => JSON.stringify({ archived: r.archived.map(a => a.sessionId), live: r.workspaces.flatMap(w => w.sessions.map(s => s.id)) }))`)
console.log('BEFORE:', before)
// 2. 还原第一个归档会话
const target = JSON.parse(before).archived[0]
if (!target) { console.log('no archived session to test'); process.exit(0) }
const u = await ev(`window.dshw.unarchiveSession(${JSON.stringify(target)}).then(r => JSON.stringify(r))`)
console.log('unarchive result:', u)
await wait(600)
// 3. 确认已回到工作区
const mid = await ev(`window.dshw.getSidebarData().then(r => JSON.stringify({ archived: r.archived.map(a => a.sessionId), live: r.workspaces.flatMap(w => w.sessions.map(s => s.id)) }))`)
console.log('AFTER UNARCHIVE:', mid)
// 4. 还原归档回去（保持原状）
const back = await ev(`window.dshw.archiveSession(${JSON.stringify(target)}, '当前状态可用吗', Date.now()).then(r => JSON.stringify(r))`)
console.log('re-archive result:', back)
await wait(600)
const after = await ev(`window.dshw.getSidebarData().then(r => JSON.stringify({ archived: r.archived.map(a => a.sessionId), live: r.workspaces.flatMap(w => w.sessions.map(s => s.id)) }))`)
console.log('AFTER RE-ARCHIVE:', after)
ws.close()
process.exit(0)
