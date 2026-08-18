/** M5 验证：6 个 Tab 功能（服务配置保存 / API 配置与测试 / 一键备份 / 日志与关于）。 */
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
const clickByText = (text) =>
  ev(`(() => { const btn = [...document.querySelectorAll('button')].find(b => b.innerText.trim().includes(${JSON.stringify(text)})); if (!btn || btn.disabled) return 'NOT_FOUND_OR_DISABLED'; btn.click(); return 'clicked'; })()`)
const clickTab = (name) =>
  ev(`(() => { const t = [...document.querySelectorAll('.settings-dialog nav button')].find(b => b.innerText.includes(${JSON.stringify(name)})); if (t) t.click(); return 'ok'; })()`)
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

// 完成向导
await clickByText('下一步')
await wait(800)
await clickByText('跳过')
await wait(800)
await clickByText('完成，开始使用')
await wait(1500)

// 打开设置（按 aria-label 定位，不受会话行按钮影响）
await ev(`(document.querySelector('aside button[aria-label="打开设置"]')).click(); 'ok'`)
await wait(800)

// Tab3 服务与运行：保存配置
await clickTab('服务与运行')
await wait(500)
console.log('Tab3 渲染:', await ev(`document.body.innerText.includes('dsh 启动参数') ? 'OK' : 'MISSING'`))
const saved = await ev(`window.dshw.updateConfig({ service: { portMode: 'fixed', port: 3456, startupTimeoutMs: 90, extraArgs: ['web'], useSystemNode: false, autoStart: false } }).then(r => JSON.stringify(r))`)
console.log('Tab3 保存:', saved)

// Tab4 模型与 API：配置 + 测试连接（无效 Key 应给出中文错误）
await clickTab('模型与 API')
await wait(500)
console.log('Tab4 渲染:', await ev(`document.body.innerText.includes('DeepSeek API Key') ? 'OK' : 'MISSING'`))
const apiSet = await ev(`window.dshw.setApiConfig({ apiKey: 'sk-invalid-test-key', baseUrl: 'https://api.deepseek.com', model: 'deepseek-chat' }).then(r => JSON.stringify(r))`)
console.log('Tab4 保存:', apiSet)
const apiTest = await ev(`window.dshw.testApiConnection().then(r => JSON.stringify(r))`, 20000)
console.log('Tab4 测试连接:', apiTest)

// Tab5 备份与恢复：一键备份
await clickTab('备份与恢复')
await wait(500)
console.log('Tab5 渲染:', await ev(`document.body.innerText.includes('一键备份') ? 'OK' : 'MISSING'`))
console.log('一键备份:', await clickByText('一键备份'))
await wait(6000)
console.log('备份列表:', await ev(`window.dshw.listBackups().then(l => JSON.stringify(l.map(b => b.name + ' ' + b.sizeBytes)))`))

// Tab6 日志与关于
await clickTab('日志与关于')
await wait(500)
console.log('Tab6 渲染:', await ev(`JSON.stringify({ logs: document.body.innerText.includes('应用日志'), about: document.body.innerText.includes('关于') })`))
console.log('日志读取:', await ev(`window.dshw.readLogs().then(l => JSON.stringify({ appLines: l.app.length, dshLines: l.dsh.length }))`))
ws.close()
process.exit(0)
