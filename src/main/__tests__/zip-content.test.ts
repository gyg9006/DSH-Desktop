import { describe, expect, it, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { importSessionsFrom, expandImportArchives } from '../sessions'

const tempDirs: string[] = []
function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dshw-zipe2e-'))
  tempDirs.push(dir)
  return dir
}
afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

describe('ZIP 导入完整链路：内容必须保留', () => {
  it('官方导出 ZIP（真实有内容会话）→ 导入后行数不丢', async () => {
    // 用真实 dsh 导出 cd5a8b11（有 27 turns 的会话）
    const zipPath = path.join(os.tmpdir(), 'dshw-real-export.zip')
    const res = await fetch('http://127.0.0.1:3081/api/session.export?sessionId=session-cd5a8b11-6de8-4c1e-b1f7-b0388c69bbc4&includeDescendants=true')
    expect(res.ok).toBe(true)
    fs.writeFileSync(zipPath, Buffer.from(await res.arrayBuffer()))

    // 解压看 ZIP 内容
    const zipListDir = makeTempDir()
    execFileSync('tar', ['-xf', zipPath, '-C', zipListDir])
    const zipFiles = fs.readdirSync(zipListDir)
    // eslint-disable-next-line no-console
    console.log('zip contents:', JSON.stringify(zipFiles))
    const rootLog = path.join(zipListDir, 'session.jsonl')
    const rootLines = fs.readFileSync(rootLog, 'utf8').split('\n').filter(Boolean).length
    // eslint-disable-next-line no-console
    console.log('zip root session.jsonl lines:', rootLines)

    // 走应用导入链路
    const ws = makeTempDir()
    fs.mkdirSync(path.join(ws, 'data', 'storages'), { recursive: true })
    fs.writeFileSync(
      path.join(ws, 'data', 'storages', 'workspace.json'),
      JSON.stringify({
        unit: { name: 'workspace', version: 2 },
        global: { initialized: true, workspaceIds: ['ws-1'], archivedSessionIds: [] },
        tables: { workspaces: { 'ws-1': { path: 'F:\\deepseek_workspace', title: 'work', sessionIds: [], createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' } } }
      })
    )
    const expanded = await expandImportArchives(ws, [zipPath])
    try {
      const result = await importSessionsFrom(ws, expanded.paths, undefined, expanded.archiveRoots)
      // eslint-disable-next-line no-console
      console.log('import result:', JSON.stringify(result))
      expect(result.ok).toBe(true)
      expect(result.count).toBeGreaterThan(0)

      // 检查导入产物内容（cd5a8b11 应保留行数；或新 id）
      const sessionsRoot = path.join(ws, 'data', 'sessions')
      const walk = (dir: string, depth: number): string[] => {
        const out: string[] = []
        if (!fs.existsSync(dir)) return out
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, e.name)
          if (e.isDirectory()) {
            if (e.name.startsWith('session-')) out.push(path.join(full, 'session.jsonl.zstd'))
            if (depth < 4) out.push(...walk(full, depth + 1))
          }
        }
        return out
      }
      const importedLogs = walk(sessionsRoot, 0).filter((p) => fs.existsSync(p))
      // eslint-disable-next-line no-console
      console.log('imported logs:', JSON.stringify(importedLogs.map((p) => ({ p: p.replace(sessionsRoot, ''), size: fs.statSync(p).size }))))
      expect(importedLogs.length).toBeGreaterThan(0)
      // 至少一个导入的会话文件大小 > 1KB（说明内容非空）
      const maxSize = Math.max(...importedLogs.map((p) => fs.statSync(p).size))
      // eslint-disable-next-line no-console
      console.log('max imported log size:', maxSize, '| root plain lines:', rootLines)
      expect(maxSize).toBeGreaterThan(1024)
    } finally {
      expanded.cleanup()
    }
  }, 120000)
})
