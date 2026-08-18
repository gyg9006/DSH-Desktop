/** 验证：主题全局化——列表/切换/CSS 变量注入/组件颜色变化/theme.css 注入。 */
const list = await fetch('http://127.0.0.1:9222/json').then((r) => r.json())
const page = list.find((t) => t.type === 'page' && t.url.includes('index.html'))
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((r) => (ws.onopen = r))
let id = 0
function ev(expression, timeout = 20000) {
  return new Promise((resolve, reject) => {
    const my = ++id
    const timer = setTimeout(() => reject(new Error('timeout')), timeout)
    const handler = (e) => {
      const m = JSON.parse(e.data)
      if (m.id === my) { clearTimeout(timer); ws.removeEventListener('message', handler); resolve(m.result?.result?.value) }
    }
    ws.addEventListener('message', handler)
    ws.send(JSON.stringify({ id: my, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true } }))
  })
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
let passed = 0, failed = 0
const check = (n, c, d = '') => { if (c) { passed++; console.log('  ✅', n) } else { failed++; console.log('  ❌', n, d) } }

await wait(5000)
// 1. 主题列表（默认 + 霓虹粉）
const tl = await ev(`window.dshw.themeList().then(l => JSON.stringify(l.map(t => t.id)))`)
console.log('主题列表:', tl)
check('含默认主题', tl.includes('default'))
check('含霓虹粉插件', tl.includes('theme-neon-pink'), tl)

// 2. 切到霓虹粉
const set = await ev(`window.dshw.themeSet('theme-neon-pink').then(r => JSON.stringify({ ok: r.ok, id: r.theme?.id }))`)
check('切换主题 ok', JSON.parse(set).ok === true, set)
await wait(1200)
// CSS 变量注入检查
const vars = await ev(`(() => { const s = getComputedStyle(document.documentElement); return JSON.stringify({ primary: s.getPropertyValue('--color-primary').trim(), primaryRgb: s.getPropertyValue('--color-primary-rgb').trim(), bg: s.getPropertyValue('--color-bg').trim() }); })()`)
console.log('CSS 变量:', vars)
const v = JSON.parse(vars)
check('--color-primary = #FF2D78', v.primary === '#FF2D78', v.primary)
check('--color-primary-rgb 注入', v.primaryRgb === '255 45 120', v.primaryRgb)
check('--color-bg = #120A18', v.bg === '#120A18', v.bg)
// 组件颜色实际变化（body 背景）
const bodyBg = await ev(`getComputedStyle(document.body).backgroundColor`)
console.log('body 背景:', bodyBg)
check('body 背景跟随主题', /rgb\(18, 10, 24\)|rgb\(18,10,24\)|#120A18/.test(bodyBg), bodyBg)
// theme.css 注入
const cssInjected = await ev(`!!document.getElementById('dshw-active-theme')`)
check('theme.css 注入', cssInjected === true)

// 3. 设置-外观主题选择 UI
await ev(`(() => { const b = [...document.querySelectorAll('aside button')].find(x => (x.title||'').includes('设置')); if (b) b.click(); return 'ok'; })()`)
await wait(800)
await ev(`(() => { const b = [...document.querySelectorAll('nav button')].find(x => x.innerText.includes('外观')); if (b) b.click(); return 'ok'; })()`)
await wait(800)
check('外观页含主题列表', await ev(`document.body.innerText.includes('霓虹粉')`))

// 4. 切回默认
await ev(`window.dshw.themeSet('default')`)
await wait(1000)
const back = await ev(`getComputedStyle(document.documentElement).getPropertyValue('--color-primary').trim()`)
check('切回默认主题', back === '#00E5FF', back)

console.log(`\n主题全局化验证: 通过 ${passed} | 失败 ${failed}`)
ws.close()
process.exit(failed ? 1 : 0)
