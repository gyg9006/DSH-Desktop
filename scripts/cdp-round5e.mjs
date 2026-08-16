/** 验证 #4：收起侧边栏时 dsh 侧边栏保持隐藏 + 对话窗口扩展；以及 npm-skill 单技能安装。 */
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
function ev(expression, timeout = 30000) {
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
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const g = (expr, timeout = 30000) => ev(`(async () => { const wv = document.querySelector('webview'); return String(await wv.executeJavaScript(${JSON.stringify(expr)}, true, ${timeout})) })()`, timeout + 3000)
const check = (n, ok, d = '') => console.log(`${ok ? '✓' : '✗'} ${n}${d ? '  ' + d : ''}`)

// 关掉设置弹窗、回会话视图
await ev(`(() => { const c = document.querySelector('.settings-dialog .el-dialog__headerbtn'); if (c) c.click(); return 'ok' })()`)
await wait(500)
await ev(`(() => { const b = [...document.querySelectorAll('aside button')].find(x => x.innerText.includes('返回会话')); if (b) b.click(); return 'ok' })()`)
await wait(600)

// 启动服务 + 打开对话
await ev(`(() => { const btn = [...document.querySelectorAll('aside button')].find(b => b.innerText.includes('启动')); if (!btn) return 'NO'; btn.click(); return 'ok' })()`)
let status = ''
for (let i = 0; i < 60; i++) {
  await wait(2500)
  status = await ev(`(() => { const d = [...document.querySelectorAll('.status-dot')].find(x => x.closest('aside')); return d ? d.className.replace('status-dot status-dot--', '') : 'none'; })()`)
  if (status === 'running') break
}
console.log('服务:', status)
await ev(`(() => { const btn = [...document.querySelectorAll('aside button')].find(b => b.innerText.includes('开始对话')); if (!btn) return 'NO'; btn.click(); return 'ok' })()`)
await wait(12000)

// 展开态：webview 宽度
const webviewW = await ev(`(async () => { const wv = document.querySelector('webview'); return wv ? wv.getBoundingClientRect().width : 0 })()`)
console.log('展开态 webview 宽:', webviewW)
// dsh 侧边栏隐藏状态
const hidden1 = await g(`(() => { const nav = [...document.querySelectorAll('button')].find(b => (b.getAttribute('aria-label') || '').includes('新建会话')); if (!nav) return 'NO_NAV'; let el = nav; while (el) { const cls = typeof el.className === 'string' ? el.className : ''; if (cls.includes('_root') && el.getBoundingClientRect().width < 150) return el.style.display === 'none' ? 'hidden' : el.style.display; el = el.parentElement } return 'NO_ROOT' })()`)
check('#4 展开态 dsh 侧边栏隐藏', hidden1 === 'hidden', hidden1)

// 收起桌面侧边栏 → webview 变宽 + dsh 侧边栏仍隐藏
await ev(`(() => { const b = document.querySelector('aside button[aria-label="收起或展开任务栏"]'); if (b) b.click(); return 'ok' })()`)
await wait(1000)
const collapsedW = await ev(`(async () => { const wv = document.querySelector('webview'); return wv ? wv.getBoundingClientRect().width : 0 })()`)
const hidden2 = await g(`(() => { const nav = [...document.querySelectorAll('button')].find(b => (b.getAttribute('aria-label') || '').includes('新建会话')); if (!nav) return 'NO_NAV'; let el = nav; while (el) { const cls = typeof el.className === 'string' ? el.className : ''; if (cls.includes('_root') && el.getBoundingClientRect().width < 150) return el.style.display === 'none' ? 'hidden' : el.style.display; el = el.parentElement } return 'NO_ROOT' })()`)
check('#4 收起后对话窗口扩展', collapsedW > webviewW, `expanded=${webviewW} collapsed=${collapsedW}`)
check('#4 收起后 dsh 侧边栏仍隐藏', hidden2 === 'hidden', hidden2)
// 收起态顶部工作区图标
const rail = await ev(`JSON.stringify([...document.querySelectorAll('aside button')].map(b => (b.getAttribute('aria-label')||'').trim()).filter(t => ['新建会话','添加工作区','搜索会话'].includes(t)))`)
check('#4 收起态顶部图标', JSON.parse(rail).length === 3, rail)
await ev(`(() => { const b = document.querySelector('aside button[aria-label="收起或展开任务栏"]'); if (b) b.click(); return 'ok' })()`)
await wait(600)

// npm-skill 单技能安装（docx ← claude-skills-library）
console.log('安装 docx 技能...')
const installRes = await ev(`window.dshw.installSkill('docx').then(r => JSON.stringify({ ok: r.ok, error: r.error, installed: r.installed }))`, 120000)
console.log('安装结果:', installRes)
const ir = JSON.parse(installRes)
check('npm-skill 单技能安装（docx）', ir.ok === true && (ir.installed || []).includes('docx'), installRes)
ws.close()
process.exit(0)
