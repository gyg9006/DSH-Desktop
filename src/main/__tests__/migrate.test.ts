import { describe, expect, it, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  checkDshDataDir,
  buildMigrationPlan,
  scanDshHome,
  scanAllDshHomes,
  listCandidateDshHomes,
  mergePatchEntries,
  dshSkillPatchEntry,
  writeHomePatch,
  readHomePatch,
  mergeSourcePatchIntoHome,
  runMigration,
  cancelMigration,
  resetMigrationCancel,
  isMigrationCancelled
} from '../migrate'

const tempDirs: string[] = []

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dshw-migrate-test-'))
  tempDirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

/** 构造一个模拟的 dsh 数据源目录。 */
function makeFakeDshHome(home: string): void {
  fs.mkdirSync(path.join(home, 'sessions'), { recursive: true })
  fs.mkdirSync(path.join(home, 'skills', 'my-skill'), { recursive: true })
  fs.mkdirSync(path.join(home, 'profiles', 'web'), { recursive: true })
  fs.mkdirSync(path.join(home, 'storages'), { recursive: true })
  fs.writeFileSync(path.join(home, 'sessions', 'a.jsonl'), '{}')
  fs.writeFileSync(path.join(home, 'sessions', 'b.jsonl'), '{}')
  fs.writeFileSync(path.join(home, 'sessions', 'c.txt'), 'ignore') // 非 jsonl 不计
  fs.writeFileSync(path.join(home, 'skills', 'my-skill', 'SKILL.md'), '# skill')
  fs.writeFileSync(path.join(home, 'skills', 'flat.md'), '# flat')
  fs.writeFileSync(path.join(home, 'profiles', 'web', 'package.json'), '{}')
  fs.writeFileSync(path.join(home, 'settings.yaml'), 'llm-deepseek:\n  apiKeyEnv: DEEPSEEK_API_KEY\n')
  fs.writeFileSync(path.join(home, '.credentials.yaml'), 'DEEPSEEK_API_KEY: sk-test\n')
  fs.writeFileSync(path.join(home, 'cordis.patch.yml'), '- id: system-prompt\n  config:\n    persona: hi\n')
}

describe('checkDshDataDir（数据目录自检，规格 4.4）', () => {
  it('存在且可写 → ok', () => {
    const ws = makeTempDir()
    fs.mkdirSync(path.join(ws, 'data'), { recursive: true })
    const status = checkDshDataDir(ws)
    expect(status.status).toBe('ok')
    expect(status.exists).toBe(true)
    expect(status.writable).toBe(true)
  })

  it('缺失 → missing（应用启动会自动重建）', () => {
    const ws = makeTempDir()
    const status = checkDshDataDir(ws)
    expect(status.status).toBe('missing')
    expect(status.exists).toBe(false)
  })
})

describe('scanDshHome（存量数据扫描）', () => {
  it('统计 sessions / skills / 配置文件', () => {
    const home = makeTempDir()
    makeFakeDshHome(home)
    const source = scanDshHome(home)!
    expect(source).not.toBeNull()
    const byKey = Object.fromEntries(source.items.map((i) => [i.key, i]))
    expect(byKey['sessions'].count).toBe(2) // 只统计 jsonl
    expect(byKey['skills'].count).toBe(2) // 1 目录束 + 1 扁平
    expect(byKey['settings'].count).toBe(1)
    expect(byKey['credentials'].count).toBe(1)
    expect(byKey['profiles'].count).toBe(1)
    expect(byKey['patch'].count).toBe(1)
    expect(source.totalSessions).toBe(2)
    expect(source.totalSkills).toBe(2)
  })

  it('嵌套会话布局也被统计（sessions/<workspace>/<id>/session.jsonl.zstd）', () => {
    const home = makeTempDir()
    fs.mkdirSync(path.join(home, 'sessions', '--my-project--', 'session-abc'), { recursive: true })
    fs.writeFileSync(path.join(home, 'sessions', '--my-project--', 'session-abc', 'session.jsonl.zstd'), 'z')
    const source = scanDshHome(home)!
    const sessions = source.items.find((i) => i.key === 'sessions')!
    expect(sessions.count).toBe(1)
    // 迁移计划也应包含该嵌套文件
    const ws = makeTempDir()
    const { entries } = buildMigrationPlan(home, ws, ['sessions'])
    expect(entries.length).toBe(1)
    expect(entries[0].relPath).toContain('session.jsonl.zstd')
  })

  it('目录不存在返回 null', () => {
    const home = path.join(makeTempDir(), 'nonexistent-dsh-home')
    expect(scanDshHome(home)).toBeNull()
  })
})

describe('listCandidateDshHomes / scanAllDshHomes', () => {
  it('候选源包含默认目录与工作文件夹 data/', () => {
    const ws = makeTempDir()
    const candidates = listCandidateDshHomes(ws)
    expect(candidates.some((c) => c.path === path.join(os.homedir(), '.dsh'))).toBe(true)
    expect(candidates.some((c) => c.path === path.join(ws, 'data'))).toBe(true)
  })

  it('DSH_HOME 与默认目录相同路径时去重', () => {
    const ws = makeTempDir()
    process.env['DSH_HOME'] = path.join(os.homedir(), '.dsh')
    try {
      const candidates = listCandidateDshHomes(ws)
      const paths = candidates.map((c) => path.resolve(c.path))
      expect(paths.filter((p) => p === path.resolve(path.join(os.homedir(), '.dsh'))).length).toBe(1)
    } finally {
      delete process.env['DSH_HOME']
    }
  })

  it('scanAllDshHomes 只返回存在的源', () => {
    const ws = makeTempDir()
    const home = makeTempDir()
    makeFakeDshHome(home)
    process.env['DSH_HOME'] = home
    try {
      const sources = scanAllDshHomes(ws)
      const paths = sources.map((s) => path.resolve(s.path))
      expect(paths).toContain(path.resolve(home))
      // 工作文件夹 data/ 不存在时不应出现在结果里（除 home 外）
      expect(paths).not.toContain(path.resolve(path.join(ws, 'data')))
    } finally {
      delete process.env['DSH_HOME']
    }
  })
})

describe('buildMigrationPlan（迁移计划与冲突）', () => {
  it('生成文件级条目并识别目标冲突', () => {
    const home = makeTempDir()
    makeFakeDshHome(home)
    const ws = makeTempDir()
    fs.mkdirSync(path.join(ws, 'data', 'sessions'), { recursive: true })
    fs.writeFileSync(path.join(ws, 'data', 'sessions', 'a.jsonl'), 'existing')

    const { entries, conflicts } = buildMigrationPlan(home, ws, ['sessions', 'skills'])
    // sessions 目录下全部文件都会迁移（a.jsonl/b.jsonl/c.txt）
    const sessionsEntries = entries.filter((e) => e.key === 'sessions')
    expect(sessionsEntries.length).toBe(3)
    expect(conflicts).toContain('a.jsonl')
    const skillsEntries = entries.filter((e) => e.key === 'skills')
    expect(skillsEntries.length).toBe(2) // SKILL.md + flat.md
    expect(skillsEntries.every((e) => e.destAbs.startsWith(path.join(ws, 'skills')))).toBe(true)
  })

  it('settings/credentials/patch 为单文件条目', () => {
    const home = makeTempDir()
    makeFakeDshHome(home)
    const ws = makeTempDir()
    const { entries } = buildMigrationPlan(home, ws, ['settings', 'credentials', 'patch'])
    expect(entries.map((e) => e.relPath).sort()).toEqual(['.credentials.yaml', 'cordis.patch.yml', 'settings.yaml'])
    expect(entries.find((e) => e.relPath === 'settings.yaml')!.destAbs).toBe(path.join(ws, 'data', 'settings.yaml'))
  })
})

describe('mergePatchEntries / writeHomePatch（workspace/skills 接入 dsh 技能根）', () => {
  it('按 id 去重，skill-filesystem 条目最后且配置指向 workspace/skills', () => {
    const base = [
      { id: 'system-prompt', config: { persona: 'x' } },
      { id: 'skill-filesystem', config: { customSkillDirs: ['OLD'] } }
    ]
    const merged = mergePatchEntries(base, [], dshSkillPatchEntry('D:/ws'))
    const ids = merged.map((e) => (e as { id: string }).id)
    expect(ids.filter((id) => id === 'skill-filesystem').length).toBe(1) // 旧条目被替换为一份
    expect(ids[ids.length - 1]).toBe('skill-filesystem') // 位于最后（生效）
    expect((merged[merged.length - 1] as { config: { customSkillDirs: string[] } }).config.customSkillDirs).toEqual([path.join('D:/ws', 'skills')])
  })

  it('writeHomePatch 落盘且可读回；与源补丁合并保留双方', () => {
    const ws = makeTempDir()
    writeHomePatch(ws)
    const patch = readHomePatch(ws)
    expect(patch.length).toBe(1)
    expect((patch[0] as { id: string }).id).toBe('skill-filesystem')

    const home = makeTempDir()
    makeFakeDshHome(home)
    mergeSourcePatchIntoHome(ws, path.join(home, 'cordis.patch.yml'))
    const merged = readHomePatch(ws)
    const ids = merged.map((e) => (e as { id: string }).id)
    expect(ids).toContain('system-prompt') // 源补丁条目并入
    expect(ids[ids.length - 1]).toBe('skill-filesystem') // 我们的条目最后（生效）
  })
})

describe('runMigration（复制/覆盖/跳过/重命名/进度/取消）', () => {
  it('默认复制全部（无冲突目标）', async () => {
    const home = makeTempDir()
    makeFakeDshHome(home)
    const ws = makeTempDir()
    const logs: string[] = []
    const result = await runMigration(ws, home, ['sessions', 'skills', 'settings'], 'overwrite', {
      log: (m) => logs.push(m),
      progress: () => undefined,
      isCancelled: () => false
    })
    expect(result.ok).toBe(true)
    expect(result.copied).toBe(6) // 3 sessions（含 c.txt） + 2 skills + 1 settings
    expect(fs.existsSync(path.join(ws, 'data', 'sessions', 'a.jsonl'))).toBe(true)
    expect(fs.existsSync(path.join(ws, 'skills', 'my-skill', 'SKILL.md'))).toBe(true)
    expect(fs.existsSync(path.join(ws, 'data', 'settings.yaml'))).toBe(true)
    // 源保留（复制而非移动）
    expect(fs.existsSync(path.join(home, 'sessions', 'a.jsonl'))).toBe(true)
  })

  it('冲突策略：跳过 / 覆盖 / 重命名', async () => {
    const home = makeTempDir()
    makeFakeDshHome(home)

    // 跳过
    const ws1 = makeTempDir()
    fs.mkdirSync(path.join(ws1, 'data', 'sessions'), { recursive: true })
    fs.writeFileSync(path.join(ws1, 'data', 'sessions', 'a.jsonl'), 'keep-me')
    const r1 = await runMigration(ws1, home, ['sessions'], 'skip', { log: () => undefined, progress: () => undefined, isCancelled: () => false })
    expect(r1.skipped).toBe(1)
    expect(fs.readFileSync(path.join(ws1, 'data', 'sessions', 'a.jsonl'), 'utf8')).toBe('keep-me')

    // 覆盖
    const ws2 = makeTempDir()
    fs.mkdirSync(path.join(ws2, 'data', 'sessions'), { recursive: true })
    fs.writeFileSync(path.join(ws2, 'data', 'sessions', 'a.jsonl'), 'old')
    const r2 = await runMigration(ws2, home, ['sessions'], 'overwrite', { log: () => undefined, progress: () => undefined, isCancelled: () => false })
    expect(r2.overwritten).toBe(1)
    expect(fs.readFileSync(path.join(ws2, 'data', 'sessions', 'a.jsonl'), 'utf8')).toBe('{}')

    // 重命名（不覆盖原目标）
    const ws3 = makeTempDir()
    fs.mkdirSync(path.join(ws3, 'data', 'sessions'), { recursive: true })
    fs.writeFileSync(path.join(ws3, 'data', 'sessions', 'a.jsonl'), 'keep-me-2')
    const r3 = await runMigration(ws3, home, ['sessions'], 'rename', { log: () => undefined, progress: () => undefined, isCancelled: () => false })
    expect(r3.renamed).toBe(1)
    expect(fs.readFileSync(path.join(ws3, 'data', 'sessions', 'a.jsonl'), 'utf8')).toBe('keep-me-2')
    const renamed = fs.readdirSync(path.join(ws3, 'data', 'sessions')).filter((f) => f.startsWith('a.jsonl.'))
    expect(renamed.length).toBe(1)
  })

  it('取消中止迁移（cbs 回调）', async () => {
    const home = makeTempDir()
    makeFakeDshHome(home)
    const ws = makeTempDir()
    let cancelled = false
    const result = await runMigration(ws, home, ['sessions', 'skills'], 'overwrite', {
      log: () => undefined,
      progress: (done) => {
        if (done >= 2) cancelled = true
      },
      isCancelled: () => cancelled
    })
    expect(result.cancelled).toBe(true)
    expect(result.ok).toBe(false)
  })

  it('取消中止迁移（标志式：cancelMigration/isMigrationCancelled）', async () => {
    const home = makeTempDir()
    makeFakeDshHome(home)
    const ws = makeTempDir()
    let fired = false
    const promise = runMigration(ws, home, ['sessions', 'skills'], 'overwrite', {
      log: () => undefined,
      progress: (done) => {
        if (done >= 1 && !fired) {
          fired = true
          cancelMigration()
        }
      },
      isCancelled: () => isMigrationCancelled()
    })
    const result = await promise
    expect(result.cancelled).toBe(true)
    expect(result.ok).toBe(false)
    // 取消标记保持到下一次运行开始（由 runMigration 起始处重置）
    expect(isMigrationCancelled()).toBe(true)
    resetMigrationCancel()
    expect(isMigrationCancelled()).toBe(false)
  })
})
