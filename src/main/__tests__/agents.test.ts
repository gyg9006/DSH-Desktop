import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { importAgent, listAgents, parseGitHubUrl, renameAgent, deleteAgent } from '../agents'

let dir: string

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agents-'))
})

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true })
})

describe('Agent：URL 解析', () => {
  it('解析合法 GitHub URL', () => {
    expect(parseGitHubUrl('https://github.com/anthropics/superpowers')).toEqual({ owner: 'anthropics', repo: 'superpowers' })
    expect(parseGitHubUrl('https://github.com/gyg9006/DSH-Desktop/')).toEqual({ owner: 'gyg9006', repo: 'DSH-Desktop' })
    expect(parseGitHubUrl('https://github.com/a/b.git')).toEqual({ owner: 'a', repo: 'b' })
  })

  it('拒绝非法 URL', () => {
    expect(parseGitHubUrl('not-a-url')).toBeNull()
    expect(parseGitHubUrl('https://example.com/a/b')).toBeNull()
    expect(parseGitHubUrl('https://github.com/onlyOwner')).toBeNull()
  })
})

describe('Agent：导入 / 重命名 / 删除', () => {
  it('非法地址返回错误', async () => {
    const result = await importAgent(dir, 'garbage')
    expect(result.ok).toBe(false)
    expect(result.error).toContain('无效')
  })

  it('列表为空默认', () => {
    expect(listAgents(dir).agents).toEqual([])
    expect(() => renameAgent(dir, 'nope', 'x')).toThrow('Agent 不存在')
    // 删除不存在的 Agent 幂等（不抛错）
    expect(deleteAgent(dir, 'nope')).toBe(true)
  })
})
