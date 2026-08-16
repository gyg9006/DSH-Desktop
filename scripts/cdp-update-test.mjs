/** M2 补充验证：欢迎页环境全绿 + npm 一键更新（update 模式）。 */
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

// 1. 欢迎页环境摘要：5 个环境状态灯应全为绿色（running）；侧栏服务灯为灰
console.log(
  '欢迎页状态灯:',
  await ev(`JSON.stringify({
    total: document.querySelectorAll('.status-dot').length,
    green: [...document.querySelectorAll('.status-dot')].filter(d => d.className.includes('status-dot--running')).length
  })`)
)

// 2. 打开设置 → 点击 npm 行的「一键更新」
//    按钮顺序（含顶部）：[0]一键更新全部 [1]node [2]npm [3]pnpm [4]git [5]dsh
await ev(`(document.querySelectorAll('aside button')[2]).click(); 'ok'`)
await new Promise((r) => setTimeout(r, 800))
console.log(
  '更新按钮数:',
  await ev(`JSON.stringify([...document.querySelectorAll('.settings-dialog button')].filter(b => b.innerText.includes('一键更新')).length)`)
)
console.log('点击 npm 更新:', await ev(`(() => {
  const btns = [...document.querySelectorAll('.settings-dialog button')].filter(b => b.innerText.includes('一键更新'));
  if (btns.length < 3 || btns[2].disabled) return '无按钮或已禁用';
  btns[2].click(); return 'clicked';
})()`))

// 3. 轮询到 完成/失败/已取消
const start = Date.now()
let final = null
while (Date.now() - start < 8 * 60 * 1000) {
  const state = await ev(`(() => {
    const tags = [...document.querySelectorAll('.settings-dialog .el-tag, .settings-dialog .status-chip')].map(t => t.innerText.trim() + '[' + (t.className.match(/el-tag--\\w+/) ?? [''])[0] + ']');
    const statusTag = tags.map(t => t.replace(/\\[.*\\]$/, '')).find(t => ['完成','失败','已取消','进行中'].includes(t));
    const logs = document.querySelector('.settings-dialog pre')?.innerText ?? '';
    return JSON.stringify({ status: statusTag ?? null, allTags: tags, last: logs.split('\\n').filter(Boolean).slice(-1)[0] ?? '' });
  })()`)
  const parsed = JSON.parse(state)
  console.log(`[${Math.round((Date.now() - start) / 1000)}s] status=${parsed.status} last=${parsed.last.slice(0, 80)}`)
  if (parsed.status === '完成' || parsed.status === '失败' || parsed.status === '已取消') {
    final = parsed
    console.log('FINAL_TAGS:', parsed.allTags?.join(' | '))
    break
  }
  await new Promise((r) => setTimeout(r, 5000))
}

ws.close()
if (final?.status !== '完成') {
  console.log('UPDATE_TEST_FAIL status=' + (final?.status ?? 'timeout'))
  process.exit(1)
}
console.log('UPDATE_TEST_OK')
process.exit(0)
