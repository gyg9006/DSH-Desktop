/** 完整验证（自包含）：打开设置 → 检查插件 Tab 三个子页 → 日志与初始化 → 关于。 */
const DEBUG_PORT = 9222
const list = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json`).then((r) => r.json())
const page = list.find((t) => t.type === 'page' && t.url.includes('index.html'))
if (!page) throw new Error('未找到应用页面')
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = () => reject(new Error('ws error')) })
let id = 0
function ev(expression, timeout = 8000) {
  return new Promise((resolve) => {
    const my = ++id
    const timer = setTimeout(() => { ws.removeEventListener('message', handler); resolve('EVAL_TIMEOUT') }, timeout)
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
  ev(`(() => { const btn = [...document.querySelectorAll('button')].find(b => b.innerText.trim().includes(${JSON.stringify(text)})); if (!btn) return 'NOT_FOUND'; if (btn.disabled) return 'DISABLED'; btn.click(); return 'clicked'; })()`)
const clickTab = (text) =>
  ev(`(() => { const t = [...document.querySelectorAll('.settings-dialog .el-tabs__item')].find(x => x.innerText.trim() === ${JSON.stringify(text)}); if (!t) return 'NOT_FOUND'; t.click(); return 'clicked'; })()`)
const closeDialog = () =>
  ev(`(() => { const b = document.querySelector('.settings-dialog .el-dialog__headerbtn'); if (b) b.click(); return 'closed'; })()`)
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

// 打开设置侧栏
await ev(`(() => { const b = document.querySelector('button[aria-label="打开设置"]'); if (b) b.click(); return 'ok'; })()`)
await wait(900)

// 侧栏设置项
console.log('侧栏设置项:', await ev(`JSON.stringify([...document.querySelectorAll('aside button')].map(b => (b.innerText||'').trim().split('\\n')[0]).filter(Boolean).slice(-12))`))

// 插件
console.log('点击插件 →', await clickByText('插件'))
await wait(1200)
console.log('插件Tab 子页:', await ev(`JSON.stringify([...document.querySelectorAll('.settings-dialog .el-tabs__item')].map(t => t.innerText.trim()))`))
console.log('无在线插件市场:', await ev(`!document.querySelector('.settings-dialog').innerText.includes('在线插件市场')`))
console.log('功能插件页 内容片段:', await ev(`(() => { const c = document.querySelector('.settings-dialog .el-tabs__content'); if (!c) return 'NO_CONTENT'; const t = c.innerText; return JSON.stringify({ hasSearchInput: !!c.querySelector('input[placeholder*="联网搜索插件"]'), hasBuiltin: t.includes('内置推荐插件'), hasSearchBtn: [...c.querySelectorAll('button')].some(b => b.innerText.includes('搜索')) }); })()`))
await clickTab('推荐技能'); await wait(800)
console.log('推荐技能页 内容片段:', await ev(`(() => { const c = document.querySelector('.settings-dialog .el-tabs__content'); if (!c) return 'NO_CONTENT'; const t = c.innerText; return JSON.stringify({ hasSearchInput: !!c.querySelector('input[placeholder*="联网搜索技能"]'), hasCurated: t.includes('精选推荐技能'), hasInstallBtns: [...c.querySelectorAll('button')].filter(b => b.innerText.includes('安装')).length }); })()`))
await clickTab('已安装'); await wait(800)
console.log('已安装页 内容片段:', await ev(`(() => { const c = document.querySelector('.settings-dialog .el-tabs__content'); if (!c) return 'NO_CONTENT'; const t = c.innerText; return JSON.stringify({ hasPlugins: t.includes('已安装插件'), hasSkills: t.includes('已安装技能'), hasSkillsDir: t.includes('workspace/skills') }); })()`))

// 日志与初始化
await closeDialog(); await wait(700)
console.log('点击日志与初始化 →', await clickByText('日志与初始化'))
await wait(1200)
console.log('日志与初始化页:', await ev(`(() => { const d = document.querySelector('.settings-dialog'); if (!d) return 'NO_DIALOG'; const t = d.innerText; return JSON.stringify({ hasLogs: t.includes('应用日志') && t.includes('dsh 运行日志'), hasReset: t.includes('初始化（把应用交给别人前的出厂重置）'), hasResetBtn: [...d.querySelectorAll('button')].some(b => b.innerText.includes('重置业务数据')), noAbout: !t.includes('更新方式') && !t.includes('客户端版本') }); })()`))

// 关于
await closeDialog(); await wait(700)
console.log('点击关于 →', await clickByText('关于'))
await wait(1200)
console.log('关于页:', await ev(`(() => { const d = document.querySelector('.settings-dialog'); if (!d) return 'NO_DIALOG'; const t = d.innerText; return JSON.stringify({ hasVersion: /v\\d+\\.\\d+\\.\\d+/.test(t), hasClient: t.includes('客户端版本'), hasDsh: t.includes('dsh：'), hasNode: t.includes('Node：'), hasGit: t.includes('Git：'), hasElectron: t.includes('Electron：'), hasChromium: t.includes('Chromium：'), hasUpdate: t.includes('更新方式') && [...d.querySelectorAll('button')].some(b => b.innerText.includes('检查更新')), noLogs: !t.includes('应用日志'), noReset: !t.includes('出厂重置') }); })()`))

ws.close()
process.exit(0)
