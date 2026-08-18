import { describe, expect, it, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { relocateWorkspace } from '../workspaceRelocate'
import type { RelocateEventPayload } from '../../shared/ipc'

const tempDirs: string[] = []
function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dshw-reloc-'))
  tempDirs.push(dir)
  return dir
}
afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

/** 搭建带内容的临时工作文件夹。 */
function makeWorkspace(): { ws: string; root: string } {
  const root = makeTempDir()
  const ws = path.join(root, 'workspace')
  fs.mkdirSync(path.join(ws, 'data', 'sessions', 'g1'), { recursive: true })
  fs.mkdirSync(path.join(ws, 'skills'), { recursive: true })
  fs.mkdirSync(path.join(ws, 'config'), { recursive: true })
  fs.mkdirSync(path.join(ws, 'runtime'), { recursive: true })
  fs.writeFileSync(path.join(ws, 'data', 'sessions', 'g1', 'a.jsonl'), 'x'.repeat(1000))
  fs.writeFileSync(path.join(ws, 'skills', 's.md'), '# skill\n')
  fs.writeFileSync(path.join(ws, 'config', 'app.json'), JSON.stringify({ onboarded: true }))
  fs.writeFileSync(path.join(ws, 'runtime', 'node.exe'), 'fake-runtime') // 运行时不应迁移
  return { ws, root }
}

describe('workspaceRelocate（工作文件夹原子迁移）', () => {
  it('迁移成功：内容复制、配置指针切换、旧目录保留为 .old、运行时排除', async () => {
    const { ws, root } = makeWorkspace()
    const events: RelocateEventPayload[] = []
    const target = path.join(root, 'ws-new')

    const result = await relocateWorkspace(target, (e) => events.push(e), { workspaceDir: ws, rootDir: root })

    expect(result.ok).toBe(true)
    expect(result.restartRequired).toBe(true)
    // 新工作文件夹内容完整
    expect(fs.readFileSync(path.join(target, 'data', 'sessions', 'g1', 'a.jsonl'), 'utf8')).toBe('x'.repeat(1000))
    expect(fs.existsSync(path.join(target, 'skills', 's.md'))).toBe(true)
    // 运行时未迁移
    expect(fs.existsSync(path.join(target, 'runtime', 'node.exe'))).toBe(false)
    // 新路径 config/app.json 指向新路径
    const cfg = JSON.parse(fs.readFileSync(path.join(target, 'config', 'app.json'), 'utf8'))
    expect(cfg.workspacePath).toBe(target)
    expect(cfg.onboarded).toBe(true)
    // 默认指针写入（原路径被重建为指针目录，仅含 config）
    const defaultCfg = JSON.parse(fs.readFileSync(path.join(root, 'workspace', 'config', 'app.json'), 'utf8'))
    expect(defaultCfg.workspacePath).toBe(target)
    // 旧目录改名保留（存在 workspace.old-*，原始内容仍在其中）
    const olds = fs.readdirSync(root).filter((n) => n.startsWith('workspace.old-'))
    expect(olds.length).toBe(1)
    expect(fs.readFileSync(path.join(root, olds[0], 'data', 'sessions', 'g1', 'a.jsonl'), 'utf8')).toBe('x'.repeat(1000))
    // 事件序列
    expect(events.some((e) => e.phase === 'done')).toBe(true)
    expect(events.filter((e) => e.phase === 'progress').length).toBeGreaterThan(0)
  })

  it('非法目标：校验失败且不产生副作用', async () => {
    const { ws, root } = makeWorkspace()
    const result = await relocateWorkspace('relative-path', () => undefined, { workspaceDir: ws, rootDir: root })
    expect(result.ok).toBe(false)
    expect(fs.existsSync(ws)).toBe(true)
  })

  it('目标与当前相同：直接拒绝', async () => {
    const { ws, root } = makeWorkspace()
    const result = await relocateWorkspace(ws, () => undefined, { workspaceDir: ws, rootDir: root })
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/相同|占用/)
  })
})
