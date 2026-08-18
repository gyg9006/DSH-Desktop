/** 验证：Node 更新后重装 pnpm → 全绿。 */
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

// 打开设置（展开态 [2]=设置）
console.log('打开设置:', await ev(`(document.querySelectorAll('aside button')[2]).click(); 'ok'`))
await new Promise((r) => setTimeout(r, 800))

// pnpm 行的「一键安装」按钮（行内按钮顺序：node/npm/pnpm/git/dsh；一键安装按钮中第 1 个 = pnpm）
console.log('点击 pnpm 安装:', await ev(`(() => {
  const btns = [...document.querySelectorAll('.settings-dialog button')].filter(b => b.innerText.includes('一键安装') && !b.innerText.includes('全部'));
  if (btns.length < 1 || btns[0].disabled) return '无按钮或已禁用';
  btns[0].click(); return 'clicked';
})()`))

const start = Date.now()
let final = null
while (Date.now() - start < 6 * 60 * 1000) {
  const state = await ev(`(() => {
    const tags = [...document.querySelectorAll('.settings-dialog .el-tag, .settings-dialog .status-chip')].map(t => t.innerText.trim());
    const statusTag = tags.find(t => ['完成','失败','已取消','进行中'].includes(t));
    const logs = document.querySelector('.settings-dialog pre')?.innerText ?? '';
    return JSON.stringify({ status: statusTag ?? null, last: logs.split('\\n').filter(Boolean).slice(-1)[0] ?? '' });
  })()`)
  const parsed = JSON.parse(state)
  console.log(`[${Math.round((Date.now() - start) / 1000)}s] status=${parsed.status} last=${parsed.last.slice(0, 80)}`)
  if (parsed.status === '完成' || parsed.status === '失败' || parsed.status === '已取消') {
    final = parsed
    break
  }
  await new Promise((r) => setTimeout(r, 5000))
}

// 最终环境行状态
console.log(
  'ENV_ROWS:',
  await ev(`JSON.stringify([...document.querySelectorAll('.settings-dialog .status-dot')].map(dot => {
    const row = dot.closest('div.flex.items-center');
    return { dot: dot.className.replace('status-dot ', ''), text: row?.innerText?.replace(/\\s+/g, ' ').trim() ?? '' };
  }))`)
)
ws.close()
if (final?.status !== '完成') {
  console.log('PNPM_INSTALL_FAIL status=' + (final?.status ?? 'timeout'))
  process.exit(1)
}
console.log('PNPM_INSTALL_OK')
process.exit(0)
