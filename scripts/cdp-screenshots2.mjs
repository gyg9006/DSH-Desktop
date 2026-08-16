/** 补充截图：设置页各 tab（环境检测 / 服务与运行 / 工作文件夹 / 备份与恢复 / 异地同步）。状态自适应。 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const outDir = path.join(__dirname, '..', 'screenshots')
fs.mkdirSync(outDir, { recursive: true })

const DEBUG_PORT = 9222
const list = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json`).then((r) => r.json())
const page = list.find((t) => t.type === 'page' && t.url.includes('index.html'))
if (!page) throw new Error('no page')
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = () => reject(new Error('ws error')) })
let id = 0
function cmd(method, params = {}, timeout = 30000) {
  return new Promise((resolve, reject) => {
    const my = ++id
    const timer = setTimeout(() => { ws.removeEventListener('message', handler); reject(new Error('timeout ' + method)) }, timeout)
    const handler = (e) => {
      const m = JSON.parse(e.data)
      if (m.id === my) {
        clearTimeout(timer)
        ws.removeEventListener('message', handler)
        if (m.error) reject(new Error(method + ': ' + m.error.message))
        else resolve(m.result)
      }
    }
    ws.addEventListener('message', handler)
    ws.send(JSON.stringify({ id: my, method, params }))
  })
}
const ev = (expression) => cmd('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }).then((r) => r.result?.value)
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
async function shot(name) {
  const result = await cmd('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
  fs.writeFileSync(path.join(outDir, name), Buffer.from(result.data, 'base64'))
  console.log('saved screenshots/' + name)
}
const asideText = () => ev(`(() => { const a = document.querySelector('aside'); return a ? a.innerText : ''; })()`)
const openSettingsView = async () => {
  const t = await asideText()
  if (t.includes('通用设置')) return 'already-settings-view'
  const r = await ev(`(() => { const b = document.querySelector('button[aria-label="打开设置"]'); if (!b) return 'NO_BTN'; b.click(); return 'clicked'; })()`)
  await wait(1500)
  return r
}
const openDialog = async () => {
  const r = await ev(`(() => { const btn = [...document.querySelectorAll('aside button')].find(b => (b.innerText||'').trim().includes('通用设置')); if (!btn) return 'NOT_FOUND'; btn.click(); return 'clicked'; })()`)
  await wait(1500)
  return r
}
const clickNav = (text) =>
  ev(`(() => { const btn = [...document.querySelectorAll('.settings-dialog nav button')].find(b => (b.innerText||'').trim().includes(${JSON.stringify(text)})); if (!btn) return 'NOT_FOUND'; btn.click(); return 'clicked'; })()`)

await cmd('Page.enable')
await wait(5000)
console.log('切换设置视图 →', await openSettingsView())
console.log('打开对话框 →', await openDialog())
console.log('对话框存在:', await ev(`document.querySelector('.settings-dialog') !== null`))
console.log('对话框 nav:', await ev(`JSON.stringify([...document.querySelectorAll('.settings-dialog nav button')].map(b => (b.innerText||'').trim().split('\\n')[0]))`))

const shots = [
  ['环境检测', 'settings-env.png'],
  ['服务与运行', 'settings-service.png'],
  ['工作文件夹', 'settings-workspace.png'],
  ['备份与恢复', 'settings-backup.png'],
  ['异地同步', 'settings-sync.png']
]
for (const [nav, file] of shots) {
  const r = await clickNav(nav)
  await wait(1500)
  console.log(nav, '→', r)
  if (r === 'clicked') await shot(file)
}
ws.close()
process.exit(0)
