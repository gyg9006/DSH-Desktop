import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { prepareLocal, applyRemote } from '../sync'

let dir: string

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-'))
  // 构造工作区内容
  fs.mkdirSync(path.join(dir, 'data', 'sessions', 'proj', 's1'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'data', 'sessions', 'proj', 's1', 'session.jsonl'), 'x\n')
  fs.mkdirSync(path.join(dir, 'skills', 'my-skill'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'skills', 'my-skill', 'SKILL.md'), '# skill\n')
  fs.mkdirSync(path.join(dir, 'data', 'storages'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'data', 'knowledge.json'), JSON.stringify({ version: 1, categories: [], entries: [] }))
  fs.writeFileSync(path.join(dir, 'data', 'agents.json'), JSON.stringify({ version: 1, agents: [] }))
  fs.writeFileSync(path.join(dir, 'data', 'storages', 'workspace.json'), JSON.stringify({}))
  fs.mkdirSync(path.join(dir, 'config'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'config', 'app.json'), JSON.stringify({}))
})

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true })
})

describe('异地同步：全工作区镜像（技能/插件/知识/配置）', () => {
  it('prepareLocal 镜像 skills / knowledge / agents / sessions / config（凭据除外）', () => {
    const copied = prepareLocal(dir)
    const syncDir = path.join(dir, 'sync')
    expect(copied).toBeGreaterThan(0)
    // 技能镜像
    expect(fs.existsSync(path.join(syncDir, 'skills', 'my-skill', 'SKILL.md'))).toBe(true)
    // 知识 / Agent / 会话
    expect(fs.existsSync(path.join(syncDir, 'data', 'knowledge.json'))).toBe(true)
    expect(fs.existsSync(path.join(syncDir, 'data', 'agents.json'))).toBe(true)
    expect(fs.existsSync(path.join(syncDir, 'data', 'sessions', 'proj', 's1', 'session.jsonl'))).toBe(true)
    // 配置镜像
    expect(fs.existsSync(path.join(syncDir, 'config', 'app.json'))).toBe(true)
    // 凭据绝不同步
    fs.writeFileSync(path.join(dir, 'data', '.credentials.yaml'), 'secret')
    fs.writeFileSync(path.join(dir, 'config', 'api.json'), JSON.stringify({ apiKey: 'sk-secret' }))
    prepareLocal(dir)
    expect(fs.existsSync(path.join(syncDir, 'data', '.credentials.yaml'))).toBe(false)
    expect(fs.existsSync(path.join(syncDir, 'config', 'api.json'))).toBe(false)
  })

  it('applyRemote 从 sync 镜像还原到本地（技能/知识）', () => {
    prepareLocal(dir)
    // 本地删除技能后，从镜像还原
    fs.rmSync(path.join(dir, 'skills'), { recursive: true, force: true })
    fs.rmSync(path.join(dir, 'data', 'knowledge.json'))
    applyRemote(dir)
    expect(fs.existsSync(path.join(dir, 'skills', 'my-skill', 'SKILL.md'))).toBe(true)
    expect(fs.existsSync(path.join(dir, 'data', 'knowledge.json'))).toBe(true)
  })
})
