import { describe, expect, it, afterEach } from 'vitest'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { matchesExclude, parseRemoteLog, parseRemoteTree, decideStatus, collectLocalFiles, buildPreview, readSyncSettings, writeSyncSettings, smartPush } from '../smartSync'
import type { SyncMode } from '../../shared/ipc'

const tempDirs: string[] = []
function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dshw-smartsync-'))
  tempDirs.push(dir)
  return dir
}
afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

/** vitest worker 内 PATH 解析不可靠（沙箱环境），显式定位 git.exe。 */
const GIT_BIN: string = (() => {
  const candidates = [
    'C:\\Program Files\\Git\\cmd\\git.exe',
    'C:\\Program Files\\Git\\bin\\git.exe',
    'C:\\Program Files (x86)\\Git\\cmd\\git.exe'
  ]
  for (const c of candidates) if (fs.existsSync(c)) return c
  for (const d of (process.env.PATH ?? '').split(';')) {
    if (!d) continue
    const c = path.join(d, 'git.exe')
    if (fs.existsSync(c)) return c
  }
  return 'git'
})()

function gitRun(cwd: string, args: string[], env: Record<string, string> = {}): void {
  const r = spawnSync(GIT_BIN, args, { cwd, encoding: 'utf8', env: { ...process.env, ...env } })
  if (r.status !== 0) {
    throw new Error(
      `git ${args.join(' ')} failed: status=${r.status} error=${r.error?.message ?? 'none'} stderr=${String(r.stderr ?? '').slice(0, 200)} stdout=${String(r.stdout ?? '').slice(0, 200)}`
    )
  }
}

/** 提交全部变更并固定 committer/author 日期（%ct 取 committer 时间）。 */
function commitAll(cwd: string, message: string, sec: number): void {
  gitRun(cwd, ['add', '-A'])
  const date = `@${sec} +0800`
  gitRun(
    cwd,
    ['-c', 'user.name=t', '-c', 'user.email=t@x', 'commit', '--date', date, '-m', message],
    { GIT_COMMITTER_DATE: date }
  )
}

/** 搭建临时工作区 + bare 远端 + 同步仓库（引擎固定使用 ws/sync）。返回 { ws, bare, t0 }。 */
function setupRepo(): { ws: string; bare: string; t0: number } {
  const ws = makeTempDir()
  const bare = path.join(makeTempDir(), 'remote.git')
  const sync = path.join(ws, 'sync')

  fs.mkdirSync(path.join(ws, 'data', 'sessions', 'group1'), { recursive: true })
  fs.mkdirSync(path.join(ws, 'skills'), { recursive: true })
  fs.mkdirSync(path.join(ws, 'config'), { recursive: true })
  fs.writeFileSync(path.join(ws, 'data', 'sessions', 'group1', 'session.jsonl'), 'v1\n')
  fs.writeFileSync(path.join(ws, 'skills', 'README.md'), 'skills\n')
  fs.writeFileSync(
    path.join(ws, 'config', 'sync.json'),
    JSON.stringify({ remoteUrl: bare.replace(/\\/g, '/'), branch: 'main' }, null, 2)
  )

  // spawnSync 的 cwd 必须已存在（否则 ENOENT），先建目录再 init
  fs.mkdirSync(bare, { recursive: true })
  fs.mkdirSync(sync, { recursive: true })
  gitRun(bare, ['init', '--bare', '-b', 'main'])
  gitRun(sync, ['init', '-b', 'main'])
  fs.mkdirSync(path.join(sync, 'data', 'sessions', 'group1'), { recursive: true })
  fs.mkdirSync(path.join(sync, 'skills'), { recursive: true })
  fs.writeFileSync(path.join(sync, 'data', 'sessions', 'group1', 'session.jsonl'), 'v1\n')
  fs.writeFileSync(path.join(sync, 'skills', 'README.md'), 'skills\n')
  const t0 = Math.floor(Date.now() / 1000) - 3600 // 1 小时前
  commitAll(sync, 'initial', t0)
  gitRun(sync, ['remote', 'add', 'origin', bare])
  gitRun(sync, ['push', '-u', 'origin', 'main'])

  return { ws, bare, t0 }
}

describe('matchesExclude（gitignore 语法）', () => {
  it('单段模式匹配任意层级 basename', () => {
    expect(matchesExclude('data/sessions/a.tmp', ['*.tmp'])).toBe(true)
    expect(matchesExclude('skills/README.md', ['*.tmp'])).toBe(false)
    expect(matchesExclude('data/archive/x', ['archive'])).toBe(true)
  })
  it('目录尾匹配目录段；根锚定只匹配根级', () => {
    expect(matchesExclude('data/tmp/x.json', ['tmp/'])).toBe(true)
    expect(matchesExclude('skills/tmp/x', ['tmp/'])).toBe(true)
    expect(matchesExclude('root-only/a', ['/root-only'])).toBe(true)
    expect(matchesExclude('data/root-only/a', ['/root-only'])).toBe(false)
  })
  it('/** 递归目录；! 取反；# 注释', () => {
    expect(matchesExclude('data/sessions/archive/a/b.json', ['data/sessions/archive/**'])).toBe(true)
    expect(matchesExclude('data/sessions/a.json', ['data/sessions/archive/**'])).toBe(false)
    expect(matchesExclude('x.tmp', ['*.tmp', '!keep.tmp'])).toBe(true)
    expect(matchesExclude('keep.tmp', ['*.tmp', '!keep.tmp'])).toBe(false)
    expect(matchesExclude('a.json', ['# comment', '*.json'])).toBe(true)
  })
})

describe('parseRemoteLog / parseRemoteTree', () => {
  it('解析 %ct --name-only 输出：首见即最新提交时间', () => {
    const raw = [
      '1580515200',
      '',
      'data/sessions/g1/a.jsonl',
      'skills/README.md',
      '',
      '1580601600',
      '',
      'data/sessions/g1/b.jsonl',
      ''
    ].join('\n')
    const map = parseRemoteLog(raw)
    expect(map.get('data/sessions/g1/a.jsonl')).toBe(1580515200)
    expect(map.get('skills/README.md')).toBe(1580515200)
    expect(map.get('data/sessions/g1/b.jsonl')).toBe(1580601600)
  })
  it('空输出 → 空 map', () => {
    expect(parseRemoteLog('').size).toBe(0)
  })
  it('parseRemoteTree 解析 ls-tree 输出', () => {
    const set = parseRemoteTree('a\nb/c\n')
    expect(set.has('a')).toBe(true)
    expect(set.has('b/c')).toBe(true)
  })
})

describe('decideStatus（纯决策）', () => {
  const base = { toleranceMs: 2000, mode: 'smart' as SyncMode }
  it('仅一方存在 → 对应方向', () => {
    expect(decideStatus({ ...base, localExists: true, localTimeMs: 1, remoteExists: false, remoteTimeMs: null, sameContent: null })).toBe('upload')
    expect(decideStatus({ ...base, localExists: false, localTimeMs: null, remoteExists: true, remoteTimeMs: 1, sameContent: null })).toBe('download')
    expect(decideStatus({ ...base, localExists: false, remoteExists: false, sameContent: null })).toBe('skip')
  })
  it('时间差 > 容差 → 新者胜', () => {
    expect(decideStatus({ ...base, localExists: true, localTimeMs: 5000, remoteExists: true, remoteTimeMs: 1000, sameContent: null })).toBe('upload')
    expect(decideStatus({ ...base, localExists: true, localTimeMs: 1000, remoteExists: true, remoteTimeMs: 5000, sameContent: null })).toBe('download')
  })
  it('容差窗口内：内容一致跳过，不一致冲突', () => {
    expect(decideStatus({ ...base, localExists: true, localTimeMs: 2000, remoteExists: true, remoteTimeMs: 2001, sameContent: true })).toBe('skip')
    expect(decideStatus({ ...base, localExists: true, localTimeMs: 2000, remoteExists: true, remoteTimeMs: 1999, sameContent: false })).toBe('conflict')
    expect(decideStatus({ ...base, localExists: true, localTimeMs: 2000, remoteExists: true, remoteTimeMs: 2001, sameContent: null })).toBe('conflict')
  })
  it('add-only：双方都存在 → 跳过；仅新增仍按方向', () => {
    const addOnly = { ...base, mode: 'add-only' as SyncMode }
    expect(decideStatus({ ...addOnly, localExists: true, localTimeMs: 5000, remoteExists: true, remoteTimeMs: 1000, sameContent: null })).toBe('skip')
    expect(decideStatus({ ...addOnly, localExists: false, remoteExists: true, remoteTimeMs: 1000, sameContent: null })).toBe('download')
    expect(decideStatus({ ...addOnly, localExists: true, localTimeMs: 5000, remoteExists: false, sameContent: null })).toBe('upload')
  })
})

describe('collectLocalFiles / 设置', () => {
  it('只收集同步清单内文件并应用排除规则', () => {
    const ws = makeTempDir()
    fs.mkdirSync(path.join(ws, 'data', 'sessions'), { recursive: true })
    fs.mkdirSync(path.join(ws, 'skills'), { recursive: true })
    fs.mkdirSync(path.join(ws, 'data', 'tmp'), { recursive: true })
    fs.mkdirSync(path.join(ws, 'config'), { recursive: true })
    fs.writeFileSync(path.join(ws, 'data', 'sessions', 'a.jsonl'), 'x')
    fs.writeFileSync(path.join(ws, 'skills', 's.md'), 'x')
    fs.writeFileSync(path.join(ws, 'data', 'tmp', 'junk.jsonl'), 'x')
    fs.writeFileSync(path.join(ws, 'config', 'app.json'), '{}')
    const files = collectLocalFiles(ws, ['data/tmp/**'])
    expect(files.has('data/sessions/a.jsonl')).toBe(true)
    expect(files.has('skills/s.md')).toBe(true)
    expect(files.has('data/tmp/junk.jsonl')).toBe(false)
    expect(files.has('config/app.json')).toBe(true)
  })

  it('设置读写（默认容差 2000ms）', () => {
    const ws = makeTempDir()
    fs.mkdirSync(path.join(ws, 'config'), { recursive: true })
    const next = writeSyncSettings({ mode: 'add-only', toleranceMs: 500, exclude: ['*.tmp'], autoSyncMinutes: 30 }, ws)
    expect(next.mode).toBe('add-only')
    const read = readSyncSettings(ws)
    expect(read.mode).toBe('add-only')
    expect(read.toleranceMs).toBe(500)
    expect(read.exclude).toEqual(['*.tmp'])
    expect(read.autoSyncMinutes).toBe(30)
  })
})

describe('buildPreview（真实 git 仓库集成）', () => {
  it('智能比对：本地新 → upload；远程新 → download；add-only → skip', async () => {
    const { ws, t0 } = setupRepo()
    const file = path.join(ws, 'data', 'sessions', 'group1', 'session.jsonl')

    // 场景 1：本地修改（内容 v2，mtime 现在 > 远程 T0）→ upload
    fs.writeFileSync(file, 'v2\n')
    const now = Date.now()
    fs.utimesSync(file, new Date(now), new Date(now))
    // skills/README.md 未被改动：mtime 对齐远程提交时间 → 内容一致 → skip
    fs.utimesSync(path.join(ws, 'skills', 'README.md'), new Date(t0 * 1000), new Date(t0 * 1000))
    const up = await buildPreview(ws, 'smart', 2000)
    expect(up.ok).toBe(true)
    expect(up.items.find((i) => i.rel === 'data/sessions/group1/session.jsonl')?.status).toBe('upload')
    expect(up.items.find((i) => i.rel === 'skills/README.md')?.status).toBe('skip')

    // 场景 2：add-only → 双方存在 → skip
    const addOnly = await buildPreview(ws, 'add-only', 2000)
    expect(addOnly.ok).toBe(true)
    expect(addOnly.items.find((i) => i.rel === 'data/sessions/group1/session.jsonl')?.status).toBe('skip')

    // 场景 3：远程新增文件（本地不存在）→ download
    const sync = path.join(ws, 'sync')
    fs.mkdirSync(path.join(sync, 'data', 'sessions', 'group2'), { recursive: true })
    fs.writeFileSync(path.join(sync, 'data', 'sessions', 'group2', 'remote.jsonl'), 'remote\n')
    const t1 = Math.floor(Date.now() / 1000)
    commitAll(sync, 'remote add', t1)
    gitRun(sync, ['push', 'origin', 'main'])

    const down = await buildPreview(ws, 'smart', 2000)
    expect(down.ok).toBe(true)
    expect(down.items.find((i) => i.rel === 'data/sessions/group2/remote.jsonl')?.status).toBe('download')

    // 场景 4：远程更新某文件（提交时间 t1 晚于本地 mtime）→ download
    fs.writeFileSync(path.join(sync, 'data', 'sessions', 'group1', 'session.jsonl'), 'v3-remote\n')
    const t2 = Math.floor(Date.now() / 1000)
    commitAll(sync, 'remote update', t2)
    gitRun(sync, ['push', 'origin', 'main'])
    // 本地文件 mtime 保持 t1 之前（当前时间接近 t2，需把本地 mtime 调旧）
    fs.utimesSync(file, new Date(t2 * 1000 - 60000), new Date(t2 * 1000 - 60000))
    const down2 = await buildPreview(ws, 'smart', 2000)
    expect(down2.items.find((i) => i.rel === 'data/sessions/group1/session.jsonl')?.status).toBe('download')

    expect(t0).toBeGreaterThan(0)
  }, 30000)

  it('冲突：双方在容差窗口内修改且内容不同 → conflict', async () => {
    const { ws } = setupRepo()
    const file = path.join(ws, 'data', 'sessions', 'group1', 'session.jsonl')
    const sync = path.join(ws, 'sync')

    // 远端提交新版本，时间设为「现在」
    fs.writeFileSync(path.join(sync, 'data', 'sessions', 'group1', 'session.jsonl'), 'remote-version\n')
    const tNow = Math.floor(Date.now() / 1000)
    commitAll(sync, 'remote change', tNow)
    gitRun(sync, ['push', 'origin', 'main'])

    // 本地也改了，且 mtime 落在容差窗口内（tNow ± 1s），内容与远端不同
    fs.writeFileSync(file, 'local-version\n')
    fs.utimesSync(file, new Date(tNow * 1000), new Date(tNow * 1000))

    const preview = await buildPreview(ws, 'smart', 2000)
    expect(preview.ok).toBe(true)
    const item = preview.items.find((i) => i.rel === 'data/sessions/group1/session.jsonl')
    expect(item?.status).toBe('conflict')
  }, 30000)

  it('首次同步（全新本地仓库）→ smartPush 以远端为基成功上传且无 rebase 卡死', async () => {
    const { ws, bare, t0 } = setupRepo()
    const file = path.join(ws, 'data', 'sessions', 'group1', 'session.jsonl')

    // 本地改新 + skills 对齐远程时间
    fs.writeFileSync(file, 'v2-first-sync\n')
    const now = Date.now()
    fs.utimesSync(file, new Date(now), new Date(now))
    fs.utimesSync(path.join(ws, 'skills', 'README.md'), new Date(t0 * 1000), new Date(t0 * 1000))

    // 删除本地 sync 仓库，模拟另一台机器的全新仓库（无本地历史）
    fs.rmSync(path.join(ws, 'sync'), { recursive: true, force: true })

    const preview = await buildPreview(ws, 'smart', 2000)
    expect(preview.ok).toBe(true)
    expect(preview.items.find((i) => i.rel === 'data/sessions/group1/session.jsonl')?.status).toBe('upload')
    expect(preview.items.find((i) => i.rel === 'skills/README.md')?.status).toBe('skip')

    const uploads = preview.items.filter((i) => i.status === 'upload').map((i) => i.rel)
    const result = await smartPush(ws, uploads, 'smart')
    expect(result.ok).toBe(true)
    expect(result.pushed).toBeGreaterThan(0)

    // 远端已包含新版本内容；历史为 initial + smart push 两条，无残留 rebase 状态
    const remoteContent = spawnSync(GIT_BIN, ['show', 'main:data/sessions/group1/session.jsonl'], { cwd: bare, encoding: 'utf8' })
    expect(remoteContent.stdout.trim()).toBe('v2-first-sync')
    const remoteLog = spawnSync(GIT_BIN, ['log', '--oneline'], { cwd: bare, encoding: 'utf8' })
    expect(remoteLog.stdout.trim().split('\n').length).toBe(2)
    expect(fs.existsSync(path.join(ws, 'sync', '.git', 'rebase-merge'))).toBe(false)
    expect(fs.existsSync(path.join(ws, 'sync', '.git', 'rebase-apply'))).toBe(false)
  }, 30000)
})
