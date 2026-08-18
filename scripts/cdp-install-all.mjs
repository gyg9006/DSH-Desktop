/**
 * M2 端到端验证：打开设置 → 环境检测 Tab → 点击「一键安装全部缺失项」→ 轮询直到完成。
 * 真实下载安装便携 Node / pnpm / Git / dsh，全程通过 CDP 驱动与观察。
 */
const DEBUG_PORT = 9222
const POLL_MS = 8000
const MAX_WAIT_MS = 20 * 60 * 1000 // 20 分钟上限

const list = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json`).then((r) => r.json())
const page = list.find((t) => t.type === 'page' && t.url.includes('index.html'))
if (!page) throw new Error('未找到应用页面')
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((resolve, reject) => {
  ws.onopen = resolve
  ws.onerror = () => reject(new Error('ws error'))
})

let id = 0
function ev(expression) {
  return new Promise((resolve) => {
    const my = ++id
    const handler = (e) => {
      const m = JSON.parse(e.data)
      if (m.id === my) {
        ws.removeEventListener('message', handler)
        resolve(m.result?.result?.value ?? JSON.stringify(m.result?.exceptionDetails ?? ''))
      }
    }
    ws.addEventListener('message', handler)
    ws.send(JSON.stringify({ id: my, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true } }))
  })
}

// 1. 打开设置（展开态下按钮：[0]新建 [1]启动 [2]设置 [3]主题 [4]收起）
console.log('打开设置:', await ev(`(document.querySelectorAll('aside button')[2]).click(); 'ok'`))
await new Promise((r) => setTimeout(r, 800))

// 2. 确认 EnvTab 渲染（5 项环境行）
const tabInfo = await ev(`JSON.stringify({
  rows: document.querySelectorAll('.settings-dialog .el-dialog .el-dialog__body > div > div > div > div').length
})`)
console.log('EnvTab 检查:', await ev(`JSON.stringify({
  title: document.querySelector('.settings-dialog h3')?.innerText ?? null,
  itemRows: [...document.querySelectorAll('.settings-dialog .el-dialog')].length > 0 ? document.body.innerText.includes('环境检测') : false,
  hasInstallAllBtn: [...document.querySelectorAll('.settings-dialog button')].some(b => b.innerText.includes('一键安装全部缺失项')),
  hasRedetectBtn: [...document.querySelectorAll('.settings-dialog button')].some(b => b.innerText.includes('全部重新检测'))
})`))

// 3. 点击「一键安装全部缺失项」
console.log('点击一键安装全部缺失项:', await ev(`(() => {
  const btn = [...document.querySelectorAll('.settings-dialog button')].find(b => b.innerText.includes('一键安装全部缺失项'));
  if (!btn || btn.disabled) return '无按钮或已禁用';
  btn.click(); return 'clicked';
})()`))
await new Promise((r) => setTimeout(r, 3000))

// 4. 轮询任务状态（日志区中的状态 tag：进行中/完成/失败/已取消）
const start = Date.now()
let final = null
while (Date.now() - start < MAX_WAIT_MS) {
  const state = await ev(`(() => {
    const tags = [...document.querySelectorAll('.settings-dialog .el-tag, .settings-dialog .status-chip')].map(t => t.innerText.trim() + '[' + (t.className.match(/el-tag--\\w+/) ?? [''])[0] + ']');
    const statusTag = tags.map(t => t.replace(/\\[.*\\]$/, '')).find(t => ['完成','失败','已取消','进行中'].includes(t));
    const logs = document.querySelector('.settings-dialog pre')?.innerText ?? '';
    const lines = logs.split('\\n').filter(Boolean);
    const last = lines[lines.length - 1] ?? '';
    return JSON.stringify({ status: statusTag ?? null, allTags: tags, logCount: lines.length, last });
  })()`)
  const parsed = JSON.parse(state)
  console.log(`[${Math.round((Date.now() - start) / 1000)}s] status=${parsed.status} logs=${parsed.logCount} last=${parsed.last.slice(0, 90)}`)
  if (parsed.status === '完成' || parsed.status === '失败' || parsed.status === '已取消') {
    final = parsed
    console.log('FINAL_TAGS:', parsed.allTags?.join(' | '))
    break
  }
  await new Promise((r) => setTimeout(r, POLL_MS))
}

// 5. 完成后读取最终检测状态
const dialogs = await ev(`JSON.stringify({ dialogs: document.querySelectorAll('.el-dialog').length, installAreas: [...document.querySelectorAll('.settings-dialog')].filter(el => el.innerText.includes('复制错误信息') || el.innerText.includes('任务：')).length })`)
console.log('DIALOG_INFO:', dialogs)

ws.close()
if (final?.status !== '完成') {
  console.log('INSTALL_ALL_FAIL status=' + (final?.status ?? 'timeout'))
  process.exit(1)
}
console.log('INSTALL_ALL_OK')
process.exit(0)
