/** M3 补充验证：向导手动输入校验 + workspace:set 配置指针（6.10）。 */
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
function ev(expression, timeout = 8000) {
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
const setInput = (selector, value) =>
  ev(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return 'NO_INPUT'; const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set; setter.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event('input', { bubbles: true })); return 'ok'; })()`)
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

// 1. 向导应出现（首次运行状态）
console.log('向导:', await ev(`document.querySelector('.el-step') ? '显示' : '缺失'`))

// 2. 手动输入：非法路径（相对路径）→ 即时红字
await ev(`(() => { const b = [...document.querySelectorAll('button')].find(b => b.innerText.includes('手动输入')); if (b) b.click(); return 'ok'; })()`)
await wait(400)
await setInput('input[placeholder*="绝对路径"]', 'relative/path')
await wait(400)
console.log('相对路径校验:', await ev(`document.body.innerText.includes('必须是绝对路径') ? '红字 OK' : '红字 MISSING'`))
await setInput('input[placeholder*="绝对路径"]', 'C:')
await wait(400)
console.log('根目录校验:', await ev(`document.body.innerText.includes('不能选择驱动器根目录') ? '红字 OK' : '红字 MISSING'`))

// 3. workspace:set 直调（6.10）：临时目录 → 校验 ok + 指针写入；再改回
const orig = await ev(`window.dshw.getWorkspaceInfo().then(i => i.workspacePath)`)
const tempWs = 'D:/dshw-workspace-set-test'
console.log('setWorkspacePath(临时):', await ev(`window.dshw.setWorkspacePath(${JSON.stringify(tempWs)}).then(r => JSON.stringify(r))`))
console.log('setWorkspacePath(非法):', await ev(`window.dshw.setWorkspacePath('relative/x').then(r => JSON.stringify(r))`))
console.log('setWorkspacePath(恢复):', await ev(`window.dshw.setWorkspacePath(${JSON.stringify(orig)}).then(r => JSON.stringify(r))`))
ws.close()
process.exit(0)
