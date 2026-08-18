/** 为 README 截取真实界面截图：主界面（侧边栏+dsh对话）→ 设置-插件页 → 设置-关于页。 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const outDir = path.join(__dirname, '..', 'screenshots')
fs.mkdirSync(outDir, { recursive: true })

const DEBUG_PORT = 9222
const list = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json`).then((r) => r.json())
const page = list.find((t) => t.type === 'page' && t.url.includes('index.html'))
if (!page) throw new Error('未找到应用页面')
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
const clickByText = (text) =>
  ev(`(() => { const btn = [...document.querySelectorAll('button')].find(b => b.innerText.trim().includes(${JSON.stringify(text)})); if (!btn || btn.disabled) return 'NOT_FOUND'; btn.click(); return 'clicked'; })()`)
const clickTab = (text) =>
  ev(`(() => { const t = [...document.querySelectorAll('.settings-dialog .el-tabs__item')].find(x => x.innerText.trim() === ${JSON.stringify(text)}); if (!t) return 'NOT_FOUND'; t.click(); return 'clicked'; })()`)
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

async function shot(name) {
  const result = await cmd('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
  fs.writeFileSync(path.join(outDir, name), Buffer.from(result.data, 'base64'))
  console.log('saved screenshots/' + name)
}

await cmd('Page.enable')
// 等待界面稳定（含 webview 就绪）
await wait(6000)

// 1. 主界面截图
await shot('main.png')

// 2. 打开设置 → 插件 → 推荐技能（展示联网搜索 + 精选技能）
await ev(`(() => { const b = document.querySelector('button[aria-label="打开设置"]'); if (b) b.click(); return 'ok'; })()`)
await wait(800)
await clickByText('插件')
await wait(1200)
await clickTab('推荐技能')
await wait(900)
await shot('plugins-skills.png')

// 3. 已安装页
await clickTab('已安装')
await wait(800)
await shot('plugins-installed.png')

// 4. 关于页（版本卡片 + 更新方式）
await ev(`(() => { const b = document.querySelector('.settings-dialog .el-dialog__headerbtn'); if (b) b.click(); return 'closed'; })()`)
await wait(600)
await clickByText('关于')
await wait(1200)
await shot('about.png')

// 恢复：关闭设置
await ev(`(() => { const b = document.querySelector('.settings-dialog .el-dialog__headerbtn'); if (b) b.click(); return 'closed'; })()`)
await wait(500)
ws.close()
process.exit(0)
