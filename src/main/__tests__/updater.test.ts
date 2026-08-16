import { describe, expect, it, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  parseTagVersion,
  isNewer,
  pickUpdateAsset,
  readUpdateSettings,
  writeUpdateSettings,
  checkForUpdate,
  formatBytes
} from '../updater'

const tempDirs: string[] = []

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dshw-updater-test-'))
  tempDirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

function makeWs(): string {
  const ws = makeTempDir()
  fs.mkdirSync(path.join(ws, 'config'), { recursive: true })
  return ws
}

/** 造一个最小 Response（模拟 fetch 返回）。 */
function fakeResponse(status: number, body: unknown): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => body
  } as unknown as Response
}

describe('parseTagVersion / isNewer（版本比较）', () => {
  it('解析 v0.2.0 / 0.2.0 / 带后缀', () => {
    expect(parseTagVersion('v0.2.0')?.major).toBe(0)
    expect(parseTagVersion('0.2.0')?.patch).toBe(0)
    expect(parseTagVersion('v1.2.3-beta.1')?.prerelease).toBe('beta.1')
    expect(parseTagVersion('nonsense')).toBeNull()
  })

  it('远端高于本地 → true；等于/低于/解析失败 → false', () => {
    expect(isNewer('0.1.0', 'v0.2.0')).toBe(true)
    expect(isNewer('0.2.0', 'v0.2.0')).toBe(false)
    expect(isNewer('0.3.0', 'v0.2.0')).toBe(false)
    expect(isNewer('0.1.0', undefined)).toBe(false)
    expect(isNewer('0.1.0', 'abc')).toBe(false)
  })
})

describe('pickUpdateAsset（挑选更新包）', () => {
  it('优先 DSH-Desktop 命名的 zip', () => {
    const asset = pickUpdateAsset({
      assets: [
        { id: 1, name: 'source.zip' },
        { id: 2, name: 'DSH-Desktop-v0.2.0-win.zip' }
      ]
    })
    expect(asset?.id).toBe(2)
  })

  it('没有命名匹配时退回任意 zip', () => {
    const asset = pickUpdateAsset({ assets: [{ id: 9, name: 'bundle.zip' }] })
    expect(asset?.id).toBe(9)
  })

  it('无 zip → undefined', () => {
    expect(pickUpdateAsset({ assets: [{ id: 1, name: 'readme.txt' }] })).toBeUndefined()
    expect(pickUpdateAsset({})).toBeUndefined()
  })
})

describe('readUpdateSettings / writeUpdateSettings（持久化）', () => {
  it('默认 auto；写入后读取', () => {
    const ws = makeWs()
    expect(readUpdateSettings(ws)).toEqual({ mode: 'auto' })
    const next = writeUpdateSettings({ mode: 'manual' }, ws)
    expect(next.mode).toBe('manual')
    expect(readUpdateSettings(ws).mode).toBe('manual')
  })

  it('保留其他字段（lastCheckAt / lastVersion）', () => {
    const ws = makeWs()
    writeUpdateSettings({ lastCheckAt: 123, lastVersion: 'v0.2.0' }, ws)
    const next = writeUpdateSettings({ mode: 'manual' }, ws)
    expect(next.lastCheckAt).toBe(123)
    expect(next.lastVersion).toBe('v0.2.0')
  })

  it('非法 mode 回退 auto', () => {
    const ws = makeWs()
    fs.writeFileSync(
      path.join(ws, 'config', 'app.json'),
      JSON.stringify({ updater: { mode: 'evil' } }),
      'utf8'
    )
    expect(readUpdateSettings(ws).mode).toBe('auto')
  })
})

describe('checkForUpdate（注入 fetch 的纯网络逻辑）', () => {
  it('远端更新版本 → hasUpdate=true 且带 asset', async () => {
    const ws = makeWs()
    const fetchImpl = async () =>
      fakeResponse(200, {
        tag_name: 'v0.2.0',
        body: '修复若干问题',
        html_url: 'https://github.com/gyg9006/DSH-Desktop/releases/tag/v0.2.0',
        assets: [{ id: 42, name: 'DSH-Desktop-v0.2.0-win.zip', size: 1024 }]
      })
    const result = await checkForUpdate({ localVersion: '0.1.0', workspaceDir: ws, fetchImpl })
    expect(result.ok).toBe(true)
    expect(result.hasUpdate).toBe(true)
    expect(result.latest).toBe('v0.2.0')
    expect(result.assetId).toBe(42)
    expect(result.size).toBe(1024)
    expect(result.notes).toContain('修复')
  })

  it('远端相同版本 → hasUpdate=false', async () => {
    const ws = makeWs()
    const fetchImpl = async () => fakeResponse(200, { tag_name: 'v0.1.0', assets: [] })
    const result = await checkForUpdate({ localVersion: '0.1.0', workspaceDir: ws, fetchImpl })
    expect(result.hasUpdate).toBe(false)
    expect(result.message).toBe('已是最新版本')
  })

  it('远端 404（无 release）→ 暂无可用更新', async () => {
    const ws = makeWs()
    const fetchImpl = async () => fakeResponse(404, {})
    const result = await checkForUpdate({ localVersion: '0.1.0', workspaceDir: ws, fetchImpl })
    expect(result.ok).toBe(true)
    expect(result.hasUpdate).toBe(false)
    expect(result.message).toBe('暂无可用更新')
  })

  it('有更新但无 zip asset → 提示缺少更新包', async () => {
    const ws = makeWs()
    const fetchImpl = async () => fakeResponse(200, { tag_name: 'v0.2.0', assets: [{ id: 1, name: 'readme.txt' }] })
    const result = await checkForUpdate({ localVersion: '0.1.0', workspaceDir: ws, fetchImpl })
    expect(result.hasUpdate).toBe(true)
    expect(result.assetId).toBeUndefined()
    expect(result.message).toContain('缺少更新包')
  })

  it('网络失败 → ok=false', async () => {
    const ws = makeWs()
    const fetchImpl = async () => {
      throw new Error('ENOTFOUND')
    }
    const result = await checkForUpdate({ localVersion: '0.1.0', workspaceDir: ws, fetchImpl })
    expect(result.ok).toBe(false)
    expect(result.hasUpdate).toBe(false)
  })

  it('10 分钟内刚检查过且非强制 → 复用缓存', async () => {
    const ws = makeWs()
    writeUpdateSettings({ lastCheckAt: Date.now(), lastVersion: 'v0.2.0' }, ws)
    let called = 0
    const fetchImpl = async () => {
      called += 1
      return fakeResponse(200, { tag_name: 'v0.2.0', assets: [] })
    }
    const result = await checkForUpdate({ localVersion: '0.1.0', workspaceDir: ws, fetchImpl })
    expect(called).toBe(0)
    expect(result.hasUpdate).toBe(true)
  })

  it('force=true 绕过冷却', async () => {
    const ws = makeWs()
    writeUpdateSettings({ lastCheckAt: Date.now(), lastVersion: 'v0.2.0' }, ws)
    let called = 0
    const fetchImpl = async () => {
      called += 1
      return fakeResponse(200, { tag_name: 'v0.1.0', assets: [] })
    }
    await checkForUpdate({ force: true, localVersion: '0.1.0', workspaceDir: ws, fetchImpl })
    expect(called).toBe(1)
  })
})

describe('formatBytes', () => {
  it('人类可读大小', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(2048)).toBe('2 KB')
    expect(formatBytes(5 * 1024 * 1024)).toBe('5 MB')
  })
})
