import { describe, expect, it, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  isBackupDue,
  createBackup,
  listBackups,
  restoreBackup,
  pruneBackups,
  deleteBackup,
  BACKUP_DIRS
} from '../backup'

const tempDirs: string[] = []

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dshw-backup-test-'))
  tempDirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

function makeWs(ws: string): void {
  for (const dir of BACKUP_DIRS) {
    fs.mkdirSync(path.join(ws, dir), { recursive: true })
  }
  fs.mkdirSync(path.join(ws, 'data', 'sessions'), { recursive: true })
  fs.writeFileSync(path.join(ws, 'data', 'sessions', 'a.jsonl'), '{}')
  fs.writeFileSync(path.join(ws, 'skills', 'demo.md'), '# skill')
  fs.mkdirSync(path.join(ws, 'runtime', 'node'), { recursive: true })
  fs.writeFileSync(path.join(ws, 'runtime', 'node', 'node.exe'), 'BIG-RUNTIME')
}

describe('isBackupDue（自动备份周期判断）', () => {
  const now = new Date('2026-08-15T10:00:00').getTime()

  it('未开启或未设置周期 → 不触发', () => {
    expect(isBackupDue({}, now)).toBe(false)
    expect(isBackupDue({ enabled: true }, now)).toBe(false)
    expect(isBackupDue({ enabled: true, period: 'daily' }, now)).toBe(true) // lastAt 空 → 立即触发
  })

  it('每日：当天不触发，跨天触发', () => {
    const yesterday = new Date('2026-08-14T23:00:00').getTime()
    expect(isBackupDue({ enabled: true, period: 'daily', lastAt: now }, now)).toBe(false)
    expect(isBackupDue({ enabled: true, period: 'daily', lastAt: yesterday }, now)).toBe(true)
  })

  it('每周：同周不触发，跨周触发', () => {
    const lastWeek = new Date('2026-08-08T10:00:00').getTime() // 周六
    const sameWeek = new Date('2026-08-10T09:00:00').getTime() // 周一
    expect(isBackupDue({ enabled: true, period: 'weekly', lastAt: sameWeek }, now)).toBe(false)
    expect(isBackupDue({ enabled: true, period: 'weekly', lastAt: lastWeek }, now)).toBe(true)
  })
})

describe('createBackup / listBackups / restoreBackup / pruneBackups（真实 tar 打包）', () => {
  it('备份仅含业务目录，不含 runtime；可列出与恢复', async () => {
    const ws = makeTempDir()
    makeWs(ws)

    const created = await createBackup(ws)
    expect(created.ok).toBe(true)
    expect(created.sizeBytes).toBeGreaterThan(0)

    const list = listBackups(ws)
    expect(list.length).toBe(1)
    expect(list[0].name).toMatch(/^backup-\d{8}-\d{6}-\d{3}\.zip$/)

    // 恢复：先改动数据再恢复（zip 解压覆盖备份中的文件；备份外的新文件保留）
    fs.writeFileSync(path.join(ws, 'data', 'sessions', 'a.jsonl'), 'CHANGED')
    fs.writeFileSync(path.join(ws, 'skills', 'extra.md'), '# extra')
    const restored = await restoreBackup(ws, list[0].path)
    expect(restored.ok).toBe(true)
    expect(fs.readFileSync(path.join(ws, 'data', 'sessions', 'a.jsonl'), 'utf8')).toBe('{}')
    expect(fs.existsSync(path.join(ws, 'skills', 'extra.md'))).toBe(true) // 备份外文件保留（标准 zip 解压语义）
  })

  it('备份内容不含 runtime（体积/机器相关）', async () => {
    const ws = makeTempDir()
    makeWs(ws)
    const created = await createBackup(ws)
    expect(created.ok).toBe(true)
    const list = listBackups(ws)
    // 用 tar 列出 zip 内容，确认无 runtime
    const { execSync } = await import('node:child_process')
    const listing = execSync(`tar -tf "${list[0].path}"`, { encoding: 'utf8' })
    expect(listing).not.toContain('runtime')
    for (const dir of BACKUP_DIRS) {
      expect(listing).toContain(dir)
    }
  })

  it('滚动删除仅保留最新 N 份', async () => {
    const ws = makeTempDir()
    makeWs(ws)
    for (let i = 0; i < 4; i++) {
      await createBackup(ws)
      await new Promise((r) => setTimeout(r, 30))
    }
    pruneBackups(ws, 2)
    expect(listBackups(ws).length).toBe(2)
  })

  it('deleteBackup 拒绝非法文件名', () => {
    const ws = makeTempDir()
    expect(deleteBackup(ws, '../evil.zip').ok).toBe(false)
    expect(deleteBackup(ws, 'notes.txt').ok).toBe(false)
  })
})
