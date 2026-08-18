import { describe, expect, it, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  WORKSPACE_DIRS,
  RUNTIME_SUBDIRS,
  resolveDefaultWorkspaceDir,
  resolveWorkspaceDir,
  ensureWorkspaceLayout,
  validateWorkspacePath,
  writeJsonAtomic,
  readJsonFile,
  filterConfigPatch
} from '../workspace'

const tempDirs: string[] = []

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dshw-test-'))
  tempDirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

describe('resolveDefaultWorkspaceDir', () => {
  it('默认工作文件夹为 rootDir/workspace', () => {
    expect(resolveDefaultWorkspaceDir('D:/app')).toBe(path.join('D:/app', 'workspace'))
  })
})

describe('ensureWorkspaceLayout', () => {
  it('创建全部一级目录与 runtime 子目录，且幂等', () => {
    const root = makeTempDir()
    const ws = path.join(root, 'workspace')
    const created = ensureWorkspaceLayout(ws)
    for (const sub of WORKSPACE_DIRS) {
      expect(fs.existsSync(path.join(ws, sub))).toBe(true)
    }
    for (const sub of RUNTIME_SUBDIRS) {
      expect(fs.existsSync(path.join(ws, 'runtime', sub))).toBe(true)
    }
    expect(created.length).toBeGreaterThan(0)
    // 第二次调用不再新建
    expect(ensureWorkspaceLayout(ws).length).toBe(0)
  })
})

describe('resolveWorkspaceDir', () => {
  it('无配置时回退到默认位置', () => {
    const root = makeTempDir()
    const { workspaceDir, config } = resolveWorkspaceDir(root)
    expect(workspaceDir).toBe(path.join(root, 'workspace'))
    expect(config).toBeNull()
  })

  it('配置声明了 workspacePath 时采用之', () => {
    const root = makeTempDir()
    const moved = path.join(root, 'my-data')
    const ws = path.join(root, 'workspace')
    ensureWorkspaceLayout(ws)
    writeJsonAtomic(path.join(ws, 'config', 'app.json'), { workspacePath: moved })
    const { workspaceDir } = resolveWorkspaceDir(root)
    expect(workspaceDir).toBe(moved)
  })

  it('损坏的配置文件按缺失处理', () => {
    const root = makeTempDir()
    const ws = path.join(root, 'workspace')
    ensureWorkspaceLayout(ws)
    fs.writeFileSync(path.join(ws, 'config', 'app.json'), '{not json', 'utf8')
    const { workspaceDir, config } = resolveWorkspaceDir(root)
    expect(workspaceDir).toBe(ws)
    expect(config).toBeNull()
  })
})

describe('validateWorkspacePath', () => {
  it('拒绝空路径与相对路径', () => {
    expect(validateWorkspacePath('').ok).toBe(false)
    expect(validateWorkspacePath('  ').ok).toBe(false)
    expect(validateWorkspacePath('relative/path').ok).toBe(false)
  })

  it('拒绝驱动器根目录', () => {
    expect(validateWorkspacePath('C:\\').ok).toBe(false)
    expect(validateWorkspacePath('D:/').ok).toBe(false)
  })

  it('可写目录通过校验', () => {
    const root = makeTempDir()
    const result = validateWorkspacePath(root)
    expect(result.ok).toBe(true)
  })
})

describe('writeJsonAtomic / readJsonFile', () => {
  it('写入后能读回', () => {
    const root = makeTempDir()
    const file = path.join(root, 'config', 'app.json')
    writeJsonAtomic(file, { theme: 'dark', n: 1 })
    expect(readJsonFile(file)).toEqual({ theme: 'dark', n: 1 })
  })

  it('不存在或损坏返回 null', () => {
    const root = makeTempDir()
    expect(readJsonFile(path.join(root, 'missing.json'))).toBeNull()
    fs.writeFileSync(path.join(root, 'bad.json'), 'x', 'utf8')
    expect(readJsonFile(path.join(root, 'bad.json'))).toBeNull()
  })
})

describe('filterConfigPatch（IPC 配置写入白名单边界）', () => {
  const whitelist = new Set(['theme', 'sidebarCollapsed', 'onboarded', 'workspacePath'])

  it('仅保留白名单内的键', () => {
    const result = filterConfigPatch(
      { theme: 'dark', evilKey: 'x', sidebarCollapsed: true, apiKey: 'sk-leak' },
      whitelist
    )
    expect(result).toEqual({ theme: 'dark', sidebarCollapsed: true })
  })

  it('忽略 undefined 值', () => {
    const result = filterConfigPatch({ theme: undefined, onboarded: true }, whitelist)
    expect(result).toEqual({ onboarded: true })
  })

  it('键名精确匹配（大小写敏感）', () => {
    const result = filterConfigPatch({ Theme: 'dark', THEME: 'dark' }, whitelist)
    expect(Object.keys(result).length).toBe(0)
  })

  it('空补丁与非法输入返回空对象', () => {
    expect(filterConfigPatch(undefined, whitelist)).toEqual({})
    expect(filterConfigPatch({}, whitelist)).toEqual({})
    expect(filterConfigPatch(null as unknown as Record<string, unknown>, whitelist)).toEqual({})
  })
})
