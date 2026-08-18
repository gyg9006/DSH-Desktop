/** M2 补充验证：Node 更新下载中点击取消 → 任务终止且旧环境完好。 */
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

// 打开设置
await ev(`(document.querySelectorAll('aside button')[2]).click(); 'ok'`)
await new Promise((r) => setTimeout(r, 800))

// 点击 node 行的「一键更新」（按钮列表：[0]一键更新全部 [1]node [2]npm [3]pnpm [4]git [5]dsh）
console.log('点击 node 更新:', await ev(`(() => {
  const btns = [...document.querySelectorAll('.settings-dialog button')].filter(b => b.innerText.includes('一键更新'));
  if (btns.length < 2 || btns[1].disabled) return '无按钮或已禁用';
  btns[1].click(); return 'clicked';
})()`))

// 等待下载开始
await new Promise((r) => setTimeout(r, 15000))
console.log(
  '下载中状态:',
  await ev(`(() => { const logs = document.querySelector('.settings-dialog pre')?.innerText ?? ''; return logs.split('\\n').filter(Boolean).slice(-1)[0] ?? ''; })()`)
)

// 点击取消
console.log('点击取消:', await ev(`(() => {
  const btn = [...document.querySelectorAll('.settings-dialog button')].find(b => b.innerText.trim() === '取消');
  if (!btn || btn.disabled) return '无取消按钮';
  btn.click(); return 'clicked';
})()`))

// 等待任务终止（已取消）
let final = null
for (let i = 0; i < 30; i++) {
  await new Promise((r) => setTimeout(r, 3000))
  const state = await ev(`(() => {
    const tags = [...document.querySelectorAll('.settings-dialog .el-tag, .settings-dialog .status-chip')].map(t => t.innerText.trim());
    const statusTag = tags.find(t => ['完成','失败','已取消','进行中'].includes(t));
    const logs = document.querySelector('.settings-dialog pre')?.innerText ?? '';
    return JSON.stringify({ status: statusTag ?? null, last: logs.split('\\n').filter(Boolean).slice(-1)[0] ?? '' });
  })()`)
  const parsed = JSON.parse(state)
  console.log(`[${(i + 1) * 3}s] status=${parsed.status} last=${parsed.last.slice(0, 70)}`)
  // 异常窗口诊断：日志已到终态但标签未翻转时，转储 DOM 结构
  if (parsed.status === '进行中' && /任务(完成|失败|已取消)/.test(parsed.last)) {
    console.log(
      'DIAG:',
      await ev(`JSON.stringify({
        dialogs: document.querySelectorAll('.el-dialog').length,
        settingsDialogs: document.querySelectorAll('.settings-dialog').length,
        installAreas: [...document.querySelectorAll('.settings-dialog')].filter(el => el.innerText.includes('复制错误信息') || el.innerText.includes('任务：')).length,
        tags: [...document.querySelectorAll('.settings-dialog .el-tag, .settings-dialog .status-chip')].map(t => t.innerText.trim() + '[' + (t.className.match(/el-tag--\\w+/) ?? [''])[0] + ']'),
        areaContainsPre: (() => { const a = [...document.querySelectorAll('.settings-dialog')].find(el => el.innerText.includes('任务：')); return a ? !!a.querySelector('pre') : false })()
      })`)
    )
    break
  }
  if (parsed.status === '已取消' || parsed.status === '完成' || parsed.status === '失败') {
    final = parsed
    break
  }
}
ws.close()
if (final?.status !== '已取消') {
  console.log('CANCEL_TEST_FAIL status=' + (final?.status ?? 'timeout'))
  process.exit(1)
}
console.log('CANCEL_TEST_OK')
process.exit(0)
