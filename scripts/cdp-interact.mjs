/**
 * 交互验证：点击任务栏收起按钮，检查宽度过渡与 DOM 状态。
 * 依赖 scripts/cdp-check.mjs 的 CDP 通道模式。
 */
const DEBUG_PORT = 9222

function evaluate(ws, id, expression) {
  return new Promise((resolve, reject) => {
    const onMessage = (event) => {
      const msg = JSON.parse(event.data)
      if (msg.id === id) {
        ws.removeEventListener('message', onMessage)
        resolve(msg.result?.result?.value)
      }
    }
    ws.addEventListener('message', onMessage)
    ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true } }))
    setTimeout(() => reject(new Error('evaluate timeout')), 10000)
  })
}

async function main() {
  const list = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json`).then((r) => r.json())
  const page = list.find((t) => t.type === 'page' && t.url.includes('index.html'))
  if (!page) throw new Error('未找到应用页面')
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    ws.onopen = resolve
    ws.onerror = () => reject(new Error('ws error'))
  })

  // 1. 记录初始宽度
  const before = await evaluate(ws, 1, `document.querySelector('aside').getBoundingClientRect().width`)
  // 2. 点击收起按钮（收起前按钮序列：顶部新建(0) + 底部 设置(1)/主题(2)/收起(3)）
  await evaluate(ws, 2, `(document.querySelectorAll('aside button')[3]).click(); true`)
  // 3. 等待 200ms 动画 + 一点余量
  await new Promise((r) => setTimeout(r, 500))
  const after = await evaluate(ws, 3, `document.querySelector('aside').getBoundingClientRect().width`)
  // 4. 收起后顶部新建按钮被移除，按钮序列变为 设置(0)/主题(1)/展开(2)
  await evaluate(ws, 4, `(document.querySelectorAll('aside button')[2]).click(); true`)
  await new Promise((r) => setTimeout(r, 500))
  const expanded = await evaluate(ws, 5, `document.querySelector('aside').getBoundingClientRect().width`)

  console.log(`INTERACT_CHECK ${JSON.stringify({ before, after, expanded })}`)
  ws.close()
  const ok = before === 260 && after === 48 && expanded === 260
  process.exit(ok ? 0 : 1)
}

main().catch((err) => {
  console.log('INTERACT_CHECK_FAIL ' + String(err))
  process.exit(1)
})
