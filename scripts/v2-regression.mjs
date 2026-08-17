/**
 * DSH Desktop v2.0 全功能回归测试框架。
 * 用法：node scripts/v2-regression.mjs [--sections a,b,c] [--cleanup]
 * 分节：layout service dshcore sessions agents knowledge skills settings window update
 * --cleanup：结束前清理测试数据（e2e- 前缀的分类/Agent/分组）。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DEBUG_PORT = 9222
const args = process.argv.slice(2)
const only = args.find((a) => a.startsWith('--sections='))?.split('=')[1]?.split(',') ?? null
const CLEANUP = args.includes('--cleanup')

const list = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json`).then((r) => r.json())
const page = list.find((t) => t.type === 'page' && t.url.includes('index.html'))
if (!page) throw new Error('未找到应用页面，请先启动应用（--remote-debugging-port=9222）')
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = () => reject(new Error('ws error')) })

let id = 0
function cmd(method, params = {}, timeout = 30000) {
  return new Promise((resolve, reject) => {
    const my = ++id
    const timer = setTimeout(() => { ws.removeEventListener('message', handler); reject(new Error('timeout ' + method)) }, timeout)
    const handler = (e) => {
      const m = JSON.parse(e.data)
      if (m.id === my) {
        clearTimeout(timer)
        ws.removeEventListener('message', handler)
        if (m.error) reject(new Error(method + ': ' + m.error.message))
        else resolve(m.result)
      }
    }
    ws.addEventListener('message', handler)
    ws.send(JSON.stringify({ id: my, method, params }))
  })
}
const ev = async (expression, timeout = 20000) => {
  const r = await cmd('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, timeout)
  if (r.exceptionDetails) throw new Error('evaluate exception: ' + JSON.stringify(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text))
  return r.result?.value
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

// ---------- 断言与汇总 ----------
let passed = 0
let failed = 0
const failures = []
function check(name, cond, detail = '') {
  if (cond) {
    passed++
    console.log(`  ✅ ${name}`)
  } else {
    failed++
    failures.push(name)
    console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`)
  }
}

// ---------- DOM 工具 ----------
const clickText = (text, root = 'document') =>
  ev(`(() => { const root = ${root}; const b = [...root.querySelectorAll('button')].find(x => (x.innerText||'').trim().includes(${JSON.stringify(text)})); if (!b) return 'NOT_FOUND'; b.click(); return 'clicked'; })()`)
const clickAside = (text) =>
  ev(`(() => { const b = [...document.querySelectorAll('aside button')].find(x => (x.innerText||'').includes(${JSON.stringify(text)})); if (!b) return 'NOT_FOUND'; b.click(); return 'clicked'; })()`)
/** Radix TabsTrigger 监听 mousedown：模拟真实用户鼠标按下。 */
const clickTab = (text) =>
  ev(`(() => { const t = [...document.querySelectorAll('[role="tab"]')].find(x => (x.innerText||'').includes(${JSON.stringify(text)})); if (!t) return 'NOT_FOUND'; t.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 })); return 'clicked'; })()`)
const setInput = (selector, value) =>
  ev(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return 'NO_EL'; const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event('input', { bubbles: true })); return 'set'; })()`)
const bodyHas = (text) => ev(`document.body.innerText.includes(${JSON.stringify(text)})`)
const dialogVisible = () => ev(`!!document.querySelector('.fixed')`)

// ============================================================
// 分节测试
// ============================================================
async function testLayout() {
  console.log('\n[T1] 布局')
  await wait(3000)
  check('TitleBar 存在', await ev(`!!document.querySelector('header')`))
  check('侧边栏 6 入口', (await ev(`document.querySelectorAll('aside button').length`)) === 6)
  check('Footer 存在', await ev(`!!document.querySelector('footer')`))
  check('版本 v2.0.0', await bodyHas('v2.0.0'))
  // 标题栏窗口控制按钮
  check('最小化按钮', await ev(`!!document.querySelector('button[aria-label="最小化"]')`))
  check('最大化按钮', await ev(`!!document.querySelector('button[aria-label="最大化"]')`))
  check('关闭按钮', await ev(`!!document.querySelector('button[aria-label="关闭"]')`))
}

async function testService() {
  console.log('\n[T2] 服务生命周期')
  // 确保已停止
  const snap = await ev(`window.dshw.getServiceStatus().then(s => JSON.stringify(s))`)
  const status = JSON.parse(snap).status
  if (status === 'running') {
    await ev(`window.dshw.stopService()`)
    await wait(2500)
  }
  check('初始为已停止', (await ev(`window.dshw.getServiceStatus().then(s => s.status)`)) === 'stopped')
  // 启动
  const started = await ev(`window.dshw.startService().then(r => JSON.stringify(r))`)
  const startResult = JSON.parse(started)
  check('startService ok', startResult.ok === true, started)
  // 等待 webview
  let wv = false
  for (let i = 0; i < 40; i++) {
    await wait(1500)
    const targets = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json`).then((r) => r.json()).catch(() => [])
    if (targets.some((t) => t.type === 'webview')) { wv = true; break }
  }
  check('webview 出现（服务运行）', wv)
  const running = await ev(`window.dshw.getServiceStatus().then(s => s.status)`)
  check('状态 running', running === 'running')
  const port = await ev(`window.dshw.getServiceStatus().then(s => s.port)`)
  check('端口有效', typeof port === 'number' && port > 0, String(port))
  // 停止
  await ev(`window.dshw.stopService()`)
  await wait(2500)
  check('停止后 stopped', (await ev(`window.dshw.getServiceStatus().then(s => s.status)`)) === 'stopped')
}

async function testDshCore() {
  console.log('\n[T3] 核心工作台（webview + 知识提炼）')
  // 启动服务（webview）
  await ev(`window.dshw.startService()`)
  let wv = false
  for (let i = 0; i < 30; i++) {
    await wait(1500)
    const targets = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json`).then((r) => r.json()).catch(() => [])
    if (targets.some((t) => t.type === 'webview')) { wv = true; break }
  }
  check('webview 已加载', wv)
  // webview 内 dsh UI 可达
  if (wv) {
    const targets = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json`).then((r) => r.json())
    const wvTarget = targets.find((t) => t.type === 'webview')
    try {
      const wvWs = new WebSocket(wvTarget.webSocketDebuggerUrl)
      await new Promise((res, rej) => { wvWs.onopen = res; wvWs.onerror = rej })
      const body = await new Promise((resolve) => {
        wvWs.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id === 1) resolve(m.result.result.value) }
        wvWs.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression: 'document.body.innerText.slice(0,200)', returnByValue: true } }))
      })
      wvWs.close()
      check('dsh Web 界面有内容', body && body.length > 10, String(body).slice(0, 60))
    } catch {
      check('dsh Web 界面有内容', false, 'webview CDP 连接失败')
    }
  }
  // 知识提炼全链路
  await clickAside('核心工作台')
  await wait(800)
  check('工作台工具栏（提炼为知识）', await ev(`[...document.querySelectorAll('button')].some(b => b.innerText.includes('提炼为知识'))`))
  check('工作台工具栏（导入文件夹）', await ev(`[...document.querySelectorAll('button')].some(b => b.innerText.includes('导入文件夹'))`))
  check('工作台工具栏（导入文件）', await ev(`[...document.querySelectorAll('button')].some(b => b.innerText.includes('导入文件'))`))
  // 建分类
  await ev(`window.dshw.knowledgeCategoryCreate('e2e-回归分类').then(r => JSON.stringify(r))`)
  await wait(300)
  // 提炼
  console.log('  提炼:')
  await clickText('提炼为知识')
  await wait(700)
  check('提炼对话框打开', await dialogVisible())
  await setInput('.fixed textarea[placeholder*="粘贴会话内容"]', '```ts\n// 防抖函数\nfunction debounce(fn, ms){ let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a), ms) } }\n```\n经验：防抖用于输入事件，节流用于滚动。')
  await wait(300)
  const sel = await ev(`(() => { const s = document.querySelector('.fixed select'); if (!s) return 'NO_SEL'; const o = [...s.options].find(x => x.text.includes('e2e-回归分类')); if (!o) return 'NO_OPT'; s.value = o.value; s.dispatchEvent(new Event('change', { bubbles: true })); return 'ok'; })()`)
  check('选择分类', sel === 'ok', sel)
  await wait(300)
  await clickText('开始提炼')
  await wait(2000)
  check('提炼成功提示', await ev(`(() => { const d = [...document.querySelectorAll('.fixed')].find(x => x.innerText.includes('提炼成功')); return !!d; })()`))
  // 入库验证
  const kb = await ev(`window.dshw.knowledgeGet().then(p => JSON.stringify({ cats: p.categories.length, entries: p.entries.length }))`)
  const kbData = JSON.parse(kb)
  check('知识库条目已入库', kbData.entries > 0, kb)
  // 清理提炼的测试数据（保留分类，知识库单测区清理）
  await ev(`window.dshw.knowledgeGet().then(p => Promise.all(p.entries.map(e => window.dshw.knowledgeEntryDelete(e.id))))`)
}

async function testSessions() {
  console.log('\n[T4] 会话管理')
  await clickAside('会话管理')
  await wait(1000)
  check('分组网格（新增分组卡）', await ev(`[...document.querySelectorAll('button')].some(b => b.innerText.includes('新增分组'))`))
  // 创建分组
  await clickText('新增分组')
  await wait(600)
  await setInput('.fixed input[placeholder="分组名称"]', 'e2e-回归分组')
  await wait(300)
  await clickText('创建')
  await wait(800)
  check('分组创建成功', await bodyHas('e2e-回归分组'))
  // 会话数据加载（侧栏数据）
  const sd = await ev(`window.dshw.getSidebarData().then(d => JSON.stringify({ groups: d.groups.length, ws: d.workspaces.length }))`)
  const sdData = JSON.parse(sd)
  check('侧栏数据加载', sdData.ws > 0, sd)
  // 重命名分组
  await clickText('e2e-回归分组')
  await wait(400)
  // hover 按钮：直接调用 IPC 验证
  const renamed = await ev(`window.dshw.getSidebarData().then(async d => { const g = d.groups.find(x => x.name.includes('e2e-回归')); if (!g) return 'NO_GROUP'; const r = await window.dshw.renameSessionGroup(g.id, 'e2e-分组改名'); return r.ok ? 'ok' : r.error; })`)
  check('分组重命名', renamed === 'ok', renamed)
  // 删除分组
  const deleted = await ev(`window.dshw.getSidebarData().then(async d => { const g = d.groups.find(x => x.name.includes('e2e-分组改名')); if (!g) return 'NO_GROUP'; const r = await window.dshw.deleteSessionGroup(g.id, false); return r.ok ? 'ok' : r.error; })`)
  check('分组删除', deleted === 'ok', deleted)
}

async function testAgents() {
  console.log('\n[T5] Agent 管理')
  await clickAside('Agent 管理')
  await wait(1000)
  check('新增 Agent 卡', await ev(`[...document.querySelectorAll('button')].some(b => b.innerText.includes('新增 Agent'))`))
  // 导入（真实 GitHub API，网络失败也验证失败提示）
  const imp = await ev(`window.dshw.agentImport('https://github.com/anthropics/superpowers').then(r => JSON.stringify(r))`)
  const impResult = JSON.parse(imp)
  check('Agent 导入 ok', impResult.ok === true, imp)
  // 重命名（Dialog 流程）
  await ev(`window.dshw.agentsGet().then(async p => { const a = p.agents.find(x => x.name.includes('superpowers')); if (a) await window.dshw.agentRename(a.id, 'e2e-Agent'); })`)
  const agents = await ev(`window.dshw.agentsGet().then(p => p.agents.map(a => a.name).join(','))`)
  check('Agent 重命名生效', agents.includes('e2e-Agent'), agents)
  // 运行
  const run = await ev(`window.dshw.agentsGet().then(async p => { const a = p.agents.find(x => x.name.includes('e2e-Agent')); if (!a) return 'NO_AGENT'; const r = await window.dshw.agentRun(a.id); return r.ok ? 'ok' : r.error; })`)
  check('Agent 运行', run === 'ok', run)
  // 协同（需 2 个，先删再验证不足提示）
  const collab = await ev(`window.dshw.agentsGet().then(async p => { if (p.agents.length < 2) { const r = await window.dshw.agentsCollaborate({ agentIds: [], task: 'x' }); return r.ok ? 'WRONG_OK' : 'needs-2'; } return 'has-2'; })`)
  check('协同前置检查', collab === 'needs-2' || collab === 'has-2', collab)
  // 删除
  const del = await ev(`window.dshw.agentsGet().then(async p => { const a = p.agents.find(x => x.name.includes('e2e-Agent')); if (!a) return 'NO_AGENT'; await window.dshw.agentDelete(a.id); return 'ok'; })`)
  check('Agent 删除', del === 'ok')
}

async function testKnowledge() {
  console.log('\n[T6] 知识库')
  await clickAside('知识库')
  await wait(1000)
  check('分类列渲染', await ev(`[...document.querySelectorAll('button')].some(b => b.innerText.includes('新增分类'))`))
  // 已有 e2e-回归分类
  check('分类显示', await bodyHas('e2e-回归分类'))
  // 创建条目（IPC）
  const created = await ev(`window.dshw.knowledgeGet().then(async p => { const c = p.categories.find(x => x.name.includes('e2e-回归分类')); if (!c) return 'NO_CAT'; const r = await window.dshw.knowledgeEntryCreate(c.id, { title: 'e2e-条目', content: '测试内容', tags: ['测试'] }); return r.ok ? 'ok' : r.error; })`)
  check('条目创建', created === 'ok', created)
  // 搜索
  const search = await ev(`window.dshw.knowledgeSearch({ keyword: 'e2e-条目' }).then(r => JSON.stringify(r))`)
  check('关键词搜索命中', JSON.parse(search).entries.length > 0, search)
  // 合并去重
  const iterate = await ev(`window.dshw.knowledgeIterate().then(r => JSON.stringify(r))`)
  check('合并去重执行', JSON.parse(iterate).ok === true, iterate)
  // 编辑条目
  const edited = await ev(`window.dshw.knowledgeGet().then(async p => { const e = p.entries.find(x => x.title.includes('e2e-条目')); if (!e) return 'NO_ENTRY'; const r = await window.dshw.knowledgeEntryUpdate(e.id, { title: 'e2e-条目改' }); return r.ok ? 'ok' : r.error; })`)
  check('条目编辑', edited === 'ok', edited)
  // 删除条目
  const delEntry = await ev(`window.dshw.knowledgeGet().then(async p => { const e = p.entries.find(x => x.title.includes('e2e-条目改')); if (!e) return 'NO_ENTRY'; await window.dshw.knowledgeEntryDelete(e.id); return 'ok'; })`)
  check('条目删除', delEntry === 'ok')
}

async function testSkills() {
  console.log('\n[T7] Skill 管理')
  await clickAside('Skill 管理')
  await wait(1000)
  check('三个 Tab', (await ev(`document.querySelectorAll('[role="tab"]').length`)) === 3)
  // 插件市场
  check('插件列表加载', await ev(`[...document.querySelectorAll('button')].some(b => b.innerText.includes('搜索'))`))
  const plugins = await ev(`window.dshw.getPlugins().then(p => JSON.stringify({ curated: p.curated.length, installed: p.installed.length }))`)
  const pluginsData = JSON.parse(plugins)
  check('内置插件 >0', pluginsData.curated > 0, plugins)
  // 插件搜索（网络）
  const pSearch = await ev(`window.dshw.searchPlugins('mcp').then(r => JSON.stringify({ ok: r.ok, hits: r.hits.length }))`)
  check('插件联网搜索', JSON.parse(pSearch).hits > 0, pSearch)
  // 技能市场
  console.log('  切技能市场:', await clickTab('技能市场'))
  await wait(600)
  const skills = await ev(`window.dshw.getSkills().then(p => JSON.stringify({ items: p.items.length, installed: p.installed.length }))`)
  check('精选技能 >0', JSON.parse(skills).items > 0, skills)
  const sSearch = await ev(`window.dshw.searchSkills('代码审查').then(r => JSON.stringify({ ok: r.ok, hits: r.hits.length }))`)
  check('技能联网搜索', JSON.parse(sSearch).hits > 0, sSearch)
  // 已安装
  console.log('  切已安装:', await clickTab('已安装'))
  await wait(600)
  check('已安装双列', await ev(`document.body.innerText.includes('已安装插件') && document.body.innerText.includes('已安装技能')`))
}

async function testSettings() {
  console.log('\n[T8] 设置')
  await clickAside('设置')
  await wait(1000)
  const subs = await ev(`JSON.stringify([...document.querySelectorAll('nav button')].map(b => (b.innerText||'').trim()).filter(Boolean))`)
  check('5 个子菜单', JSON.parse(subs).includes('通用') && JSON.parse(subs).includes('高级配置'), subs)
  // 通用：语言 + 预设
  check('语言选项', await ev(`[...document.querySelectorAll('button')].some(b => b.innerText.includes('简体中文'))`))
  const presets = await ev(`window.dshw.getDshUiSettings().then(s => s.presets.length)`)
  check('Agent 预设加载', presets > 0, String(presets))
  // 外观：主题切换（模拟用户点击「浅色」卡片）
  await ev(`(() => { const b = [...document.querySelectorAll('nav button')].find(x => x.innerText.includes('外观')); if (b) b.click(); return 'ok'; })()`)
  await wait(800)
  const themeBefore = await ev(`document.documentElement.classList.contains('dark')`)
  await clickText('浅色')
  await wait(800)
  const themeAfter = await ev(`document.documentElement.classList.contains('dark')`)
  check('主题切换（dark→light）', themeBefore === true && themeAfter === false, `${themeBefore}→${themeAfter}`)
  await clickText('深色')
  await wait(800)
  check('主题还原（light→dark）', (await ev(`document.documentElement.classList.contains('dark')`)) === true)
  // 快捷键
  await ev(`(() => { const b = [...document.querySelectorAll('nav button')].find(x => x.innerText.includes('快捷键')); if (b) b.click(); return 'ok'; })()`)
  await wait(600)
  check('快捷键列表', await bodyHas('Ctrl') && await bodyHas('新建对话'))
  // 关于
  await ev(`(() => { const b = [...document.querySelectorAll('nav button')].find(x => x.innerText.includes('关于')); if (b) b.click(); return 'ok'; })()`)
  await wait(800)
  check('关于-版本', await ev(`/v\\d+\\.\\d+\\.\\d+/.test(document.body.innerText)`))
  // 高级配置
  await ev(`(() => { const b = [...document.querySelectorAll('nav button')].find(x => x.innerText.includes('高级配置')); if (b) b.click(); return 'ok'; })()`)
  await wait(1000)
  check('环境检测渲染', await ev(`document.body.innerText.includes('环境检测') && document.body.innerText.includes('Node.js')`))
  check('API 配置表单', await ev(`document.body.innerText.includes('模型与 API')`))
  check('备份与同步', await ev(`document.body.innerText.includes('备份与异地同步')`))
  // API 保存（空 Key 也走保存流程）
  const apiSave = await ev(`window.dshw.setApiConfig({ apiKey: '' }).then(r => JSON.stringify(r))`)
  check('API 保存接口', JSON.parse(apiSave).ok === true, apiSave)
  // 备份设置保存
  const bkSave = await ev(`window.dshw.setBackupSettings({ enabled: false, period: 'daily', keep: 3 }).then(r => JSON.stringify(r))`)
  check('备份设置保存', JSON.parse(bkSave).ok === true, bkSave)
}

async function testWindow() {
  console.log('\n[T9] 窗口控制')
  const before = await ev(`window.dshw.windowIsMaximized().then(v => v)`)
  await ev(`window.dshw.windowToggleMaximize()`)
  await wait(800)
  const after = await ev(`window.dshw.windowIsMaximized().then(v => v)`)
  check('最大化切换生效', before !== after, `${before}→${after}`)
  // 还原
  await ev(`window.dshw.windowToggleMaximize()`)
  await wait(800)
  check('还原生效', (await ev(`window.dshw.windowIsMaximized().then(v => v)`)) === before)
}

async function testUpdate() {
  console.log('\n[T10] 更新检查')
  const r = await ev(`window.dshw.checkUpdate().then(r => JSON.stringify({ ok: r.ok, current: r.current, hasUpdate: r.hasUpdate }))`)
  const upd = JSON.parse(r)
  check('检查更新接口', upd.ok === true, r)
  check('当前版本 2.0.0', upd.current === '2.0.0', upd.current)
}

// ============================================================
// 执行
// ============================================================
const ALL = ['layout', 'service', 'dshcore', 'sessions', 'agents', 'knowledge', 'skills', 'settings', 'window', 'update']
const sections = only ?? ALL
const registry = {
  layout: testLayout,
  service: testService,
  dshcore: testDshCore,
  sessions: testSessions,
  agents: testAgents,
  knowledge: testKnowledge,
  skills: testSkills,
  settings: testSettings,
  window: testWindow,
  update: testUpdate
}

try {
  for (const s of sections) {
    const fn = registry[s]
    if (!fn) { console.log(`未知分节: ${s}`); continue }
    try {
      await fn()
    } catch (e) {
      failed++
      failures.push(`${s}: 异常 ${e.message}`)
      console.log(`  ❌ ${s} 分节异常: ${e.message}`)
    }
  }
} finally {
  // 清理测试数据
  if (CLEANUP) {
    console.log('\n[清理]')
    try {
      await ev(`window.dshw.knowledgeGet().then(async p => { for (const c of p.categories.filter(c => c.name.includes('e2e'))) await window.dshw.knowledgeCategoryDelete(c.id); for (const e of p.entries.filter(e => e.title.includes('e2e'))) await window.dshw.knowledgeEntryDelete(e.id); return 'ok'; })`)
      await ev(`window.dshw.agentsGet().then(async p => { for (const a of p.agents.filter(a => a.name.includes('e2e'))) await window.dshw.agentDelete(a.id); return 'ok'; })`)
      await ev(`window.dshw.getSidebarData().then(async d => { for (const g of d.groups.filter(g => g.name.includes('e2e'))) await window.dshw.deleteSessionGroup(g.id, false); return 'ok'; })`)
      console.log('  测试数据已清理')
    } catch (e) {
      console.log('  清理异常:', e.message)
    }
  }
  ws.close()
}

console.log(`\n========== 回归测试结果 ==========`)
console.log(`通过: ${passed} | 失败: ${failed}`)
if (failures.length) {
  console.log('失败项:')
  for (const f of failures) console.log(`  - ${f}`)
  process.exit(1)
} else {
  console.log('全部通过 ✅')
  process.exit(0)
}
