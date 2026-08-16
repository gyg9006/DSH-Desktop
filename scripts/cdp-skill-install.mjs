/** 验证 #3：推荐技能页签 + 绿色推荐标签 + npm 技能真实安装。 */
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
function ev(expression, timeout = 120000) {
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
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

// 打开设置 → 插件 → 推荐技能
await ev(`(() => { const b = [...document.querySelectorAll('button')].find(x => x.innerText.includes('设置')); if (b) b.click(); return 'ok' })()`)
await wait(600)
await ev(`(() => { const nav = document.querySelector('.settings-dialog nav'); const tab = [...nav.querySelectorAll('button')].find(b => b.innerText.includes('插件')); if (tab) tab.click(); return 'ok' })()`)
await wait(900)
await ev(`(() => { const tab = [...document.querySelectorAll('.plugin-tabs .el-tabs__item')].find(t => t.innerText.includes('推荐技能')); if (tab) tab.click(); return 'ok' })()`)
await wait(900)

const skillView = await ev(`JSON.stringify({
  cards: [...document.querySelectorAll('.plugin-tabs .el-tab-pane:not([style*="display: none"]) .rounded-lg')].length,
  hasAnthropic: document.body.innerText.includes('Word 文档') && document.body.innerText.includes('PDF 深度研究'),
  hasSuperpowers: document.body.innerText.includes('头脑风暴'),
  greenBadges: [...document.querySelectorAll('.plugin-tabs .bg-green-500')].length,
  npmSource: document.body.innerText.includes('npm 直装'),
  githubSource: document.body.innerText.includes('GitHub')
})`)
const sv = JSON.parse(skillView)
const check = (n, ok, d = '') => console.log(`${ok ? '✓' : '✗'} ${n}${d ? '  ' + d : ''}`)
check('#3 推荐技能列表（≥8 项含官方/社区）', sv.cards >= 8 && sv.hasAnthropic && sv.hasSuperpowers, JSON.stringify(sv))
check('#3 绿色「推荐」标签', sv.greenBadges >= 8, `badges=${sv.greenBadges}`)
check('#3 GitHub / npm 双源标注', sv.npmSource && sv.githubSource)

// 安装 npm 技能合集（真实网络安装，无需 GitHub）
const installBtn = await ev(`(() => {
  const cards = [...document.querySelectorAll('.plugin-tabs .el-tab-pane:not([style*="display: none"]) .rounded-lg')]
  const card = cards.find(c => c.innerText.includes('Claude 技能合集'))
  if (!card) return 'NO_CARD'
  const btn = [...card.querySelectorAll('button')].find(b => b.innerText.includes('安装'))
  if (!btn) return 'NO_BTN'
  btn.click()
  return 'clicked'
})()`)
console.log('安装点击:', installBtn)
await wait(15000)
const installState = await ev(`JSON.stringify([...document.querySelectorAll('.el-message')].map(m => m.innerText.trim()).slice(-3))`)
console.log('toasts:', installState)
const skillsDisk = await ev(`window.dshw.getSkills().then(r => JSON.stringify({ installed: r.installed.map(s => s.id), items: r.items.map(i => i.id + ':' + i.installed) }))`)
console.log('技能状态:', skillsDisk)
ws.close()
process.exit(0)
