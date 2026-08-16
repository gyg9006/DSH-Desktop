/**
 * 冒烟验证辅助脚本：通过 CDP（--remote-debugging-port=9222）检查打包后应用的真实 DOM 状态。
 * 用法：先启动 `DSH Workbench.exe --remote-debugging-port=9222`，再执行 node scripts/cdp-check.mjs
 */
const DEBUG_PORT = 9222

async function main() {
  const list = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json`).then((r) => r.json())
  const page = list.find((t) => t.type === 'page' && t.url.includes('index.html'))
  if (!page) {
    console.log('CDP_CHECK_FAIL: 未找到应用页面，目标列表：')
    console.log(JSON.stringify(list.map((t) => ({ type: t.type, url: t.url, title: t.title })), null, 2))
    process.exit(1)
  }

  const expression = `JSON.stringify({
    title: document.title,
    hasDshwApi: typeof window.dshw === 'object' && typeof window.dshw.getAppInfo === 'function',
    appMounted: (document.querySelector('#app')?.children.length ?? 0) > 0,
    sidebarWidth: document.querySelector('aside')?.getBoundingClientRect().width ?? null,
    sidebarCollapsedBtn: !!document.querySelector('aside button'),
    statusDots: document.querySelectorAll('.status-dot').length,
    hasWelcome: !!document.querySelector('aside'),
    bodyText: document.body.innerText.slice(0, 120)
  })`

  const ws = new WebSocket(page.webSocketDebuggerUrl)
  const timeout = setTimeout(() => {
    console.log('CDP_CHECK_FAIL: WebSocket 超时')
    process.exit(1)
  }, 15000)

  ws.onopen = () => {
    ws.send(
      JSON.stringify({
        id: 1,
        method: 'Runtime.evaluate',
        params: { expression, returnByValue: true }
      })
    )
  }
  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data)
    if (msg.id === 1) {
      clearTimeout(timeout)
      const value = msg.result?.result?.value
      if (value) {
        console.log('CDP_CHECK_OK ' + value)
      } else {
        console.log('CDP_CHECK_FAIL ' + JSON.stringify(msg))
      }
      ws.close()
      process.exit(value ? 0 : 1)
    }
  }
  ws.onerror = (err) => {
    clearTimeout(timeout)
    console.log('CDP_CHECK_FAIL: WS 错误 ' + String(err?.message ?? err))
    process.exit(1)
  }
}

main().catch((err) => {
  console.log('CDP_CHECK_FAIL: ' + String(err))
  process.exit(1)
})
