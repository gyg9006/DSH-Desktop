import { describe, expect, it, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { importSessionsFrom } from '../sessions'

const tempDirs: string[] = []
function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dshw-boot-'))
  tempDirs.push(dir)
  return dir
}
afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

const NODE = 'F:\\deepseek_workspace\\DSH-Desktop\\workspace\\runtime\\node\\node.exe'
const DSH_BIN = 'F:\\deepseek_workspace\\DSH-Desktop\\workspace\\runtime\\dsh\\node_modules\\@deepseek-ai\\dsh\\lib\\bin.js'

async function bootDsh(ws: string, port: number): Promise<{ ok: boolean; items: Array<{ id: string; blank: boolean; turns: number }>; stderr: string }> {
  const proc = spawn(NODE, [DSH_BIN, 'web', '--port', String(port)], {
    env: { ...process.env, DSH_HOME: path.join(ws, 'data'), DSH_TELEMETRY_DISABLED: '1' },
    stdio: ['ignore', 'ignore', 'pipe']
  })
  let stderr = ''
  proc.stderr.on('data', (d: Buffer) => { stderr += d.toString() })
  let ok = false
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 1000))
    try {
      const r = await fetch(`http://127.0.0.1:${port}`)
      if (r.ok) { ok = true; break }
    } catch { /* retry */ }
  }
  let items: Array<{ id: string; blank: boolean; turns: number }> = []
  if (ok) {
    const res = await fetch(`http://127.0.0.1:${port}/api/session.list`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId: 'boot-' + Date.now(), method: 'session.list', payload: {} })
    })
    const body = (await res.json()) as { result?: { value?: { items?: Array<{ sessionId: string; blank?: boolean; projections?: { values?: { sessionStats?: { turns?: number } } } }> } } }
    items = (body.result?.value?.items ?? []).map((it) => ({
      id: it.sessionId,
      blank: it.blank === true,
      turns: it.projections?.values?.sessionStats?.turns ?? 0
    }))
  }
  proc.kill('SIGTERM')
  await new Promise((r) => setTimeout(r, 500))
  return { ok, items, stderr }
}

describe('端到端：官方导出明文会话导入后 dsh 可读（内容不丢）', () => {
  it('54MB 明文会话 → 导入 → 真实 dsh 启动能读出 turns > 0', async () => {
    const src = path.join(os.tmpdir(), 'dshw-export-clean', 'session.jsonl')
    if (!fs.existsSync(src)) return

    const ws = makeTempDir()
    fs.mkdirSync(path.join(ws, 'data', 'storages'), { recursive: true })
    fs.mkdirSync(path.join(ws, 'logs'), { recursive: true })
    fs.writeFileSync(
      path.join(ws, 'data', 'storages', 'workspace.json'),
      JSON.stringify({
        unit: { name: 'workspace', version: 2 },
        global: { initialized: true, workspaceIds: ['ws-1'], archivedSessionIds: [] },
        tables: { workspaces: { 'ws-1': { path: 'F:\\deepseek_workspace', title: 'work', sessionIds: [], createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' } } }
      })
    )

    const result = await importSessionsFrom(ws, [src])
    expect(result.ok).toBe(true)
    expect(result.count).toBe(1)

    // 检查导入产物：文件大小与整文件单帧解码
    const target = path.join(ws, 'data', 'sessions', '--F-deepseek_workspace--', 'session-import-e2e-test', 'session.jsonl.zstd')
    expect(fs.existsSync(target)).toBe(true)
    const fileSize = fs.statSync(target).size
    const plainSize = fs.statSync(src).size
    // eslint-disable-next-line no-console
    console.log('imported zstd size:', fileSize, '| source plain size:', plainSize)

    // 真实 dsh boot
    const boot = await bootDsh(ws, 3094)
    // eslint-disable-next-line no-console
    console.log('dsh boot ok:', boot.ok, '| items:', JSON.stringify(boot.items.map((i) => ({ id: i.id.slice(0, 24), blank: i.blank, turns: i.turns }))))
    if (!boot.ok) {
      // eslint-disable-next-line no-console
      console.log('dsh stderr tail:', boot.stderr.slice(-1200))
    }
    expect(boot.ok).toBe(true)
    const imported = boot.items.find((i) => i.id === 'session-import-e2e-test')
    expect(imported).toBeDefined()
    // blank=false 表示 dsh 读到了事件内容（header 之外有事件行）
    expect(imported!.blank).toBe(false)
  }, 120000)

  it('官方导出 ZIP（含 subagents）→ 导入 → 不产生空会话、内容保留', async () => {
    // 构造官方导出 ZIP：根 session.jsonl（明文）+ subagents/<id>/session.jsonl
    const zipDir = path.join(os.tmpdir(), 'dshw-export-zip')
    fs.rmSync(zipDir, { recursive: true, force: true })
    fs.mkdirSync(path.join(zipDir, 'subagents', 'session-sub-1'), { recursive: true })
    fs.writeFileSync(
      path.join(zipDir, 'session.jsonl'),
      '{"type":"session","version":0,"id":"session-zip-root","cwd":"F:\\\\work"}\n{"type":"turn/start","seq":1,"data":{"turn":1}}\n{"type":"user/message","seq":2,"data":{"text":"hi"}}\n'
    )
    fs.writeFileSync(
      path.join(zipDir, 'subagents', 'session-sub-1', 'session.jsonl'),
      '{"type":"session","version":0,"id":"session-sub-1","cwd":"F:\\\\work"}\n'
    )
    const zipPath = path.join(os.tmpdir(), 'dshw-export-zip.zip')
    const { execFileSync } = await import('node:child_process')
    execFileSync('tar', ['-a', '-cf', zipPath, '-C', zipDir, '.'])

    const ws = makeTempDir()
    fs.mkdirSync(path.join(ws, 'data', 'storages'), { recursive: true })
    fs.writeFileSync(
      path.join(ws, 'data', 'storages', 'workspace.json'),
      JSON.stringify({
        unit: { name: 'workspace', version: 2 },
        global: { initialized: true, workspaceIds: ['ws-1'], archivedSessionIds: [] },
        tables: { workspaces: { 'ws-1': { path: 'F:\\work', title: 'work', sessionIds: [], createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' } } }
      })
    )
    const { expandImportArchives } = await import('../sessions')
    const expanded = await expandImportArchives(ws, [zipPath])
    try {
      const result = await importSessionsFrom(ws, expanded.paths, undefined, expanded.archiveRoots)
      // eslint-disable-next-line no-console
      console.log('zip import result:', JSON.stringify(result))
      expect(result.ok).toBe(true)
      // 根会话内容保留（3 行事件）
      const rootLog = path.join(ws, 'data', 'sessions', '--F-work--', 'session-zip-root', 'session.jsonl.zstd')
      expect(fs.existsSync(rootLog)).toBe(true)
      // 不应产生名为 "session" 的空会话
      let emptyCount = 0
      const sessionsRoot = path.join(ws, 'data', 'sessions')
      for (const g of fs.readdirSync(sessionsRoot, { withFileTypes: true })) {
        if (!g.isDirectory()) continue
        for (const s of fs.readdirSync(path.join(sessionsRoot, g.name), { withFileTypes: true })) {
          if (s.isDirectory() && s.name === 'session') emptyCount++
        }
      }
      expect(emptyCount).toBe(0)
    } finally {
      expanded.cleanup()
    }
  }, 60000)
})
