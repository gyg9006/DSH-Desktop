/** v2.0 UI 骨架验证：布局元素 + 各视图切换 + 截图。 */
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
const clickNav = (text) =>
  ev(`(() => { const b = [...document.querySelectorAll('aside button')].find(x => (x.innerText||'').includes(${JSON.stringify(text)})); if (!b) return 'NOT_FOUND'; b.click(); return 'clicked'; })()`)

await cmd('Page.enable')
await wait(3000)

console.log('布局检查:', await ev(`JSON.stringify({
  titlebar: !!document.querySelector('header'),
  versionBadge: document.body.innerText.includes('v2.0.0'),
  navCount: document.querySelectorAll('aside button').length,
  navNames: [...document.querySelectorAll('aside button')].map(b => (b.innerText||'').split('\\n')[0]).filter(Boolean),
  footer: !!document.querySelector('footer'),
  footerHasStart: [...document.querySelectorAll('footer button')].some(b => b.innerText.includes('启动服务'))
})`))

await shot('v2-home.png')

// 切换各视图
const views = ['会话管理', 'Agent 管理', '知识库', 'Skill 管理', '设置']
for (const v of views) {
  console.log(v, '→', await clickNav(v))
  await wait(900)
}
await shot('v2-knowledge.png')

// 回核心工作台
await clickNav('核心工作台')
await wait(900)
console.log('工作台空态:', await ev(`document.body.innerText.includes('服务未启动')`))
await shot('v2-workbench.png')

ws.close()
process.exit(0)
