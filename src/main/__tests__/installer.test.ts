import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  pickLatestLts,
  nodeZipUrl,
  parsePortableGitVersionDir,
  compareGitVersions,
  PORTABLE_GIT_ASSET_RE,
  INSTALL_TIMEOUT_MS,
  DETECT_TIMEOUT_MS,
  InstallError,
  InstallCancelledError,
  readEnvManifest,
  bundledArchive,
  verifySha256,
  sha256Of,
  findGitRoot,
  safeRemoveDir
} from '../installer'

describe('safeRemoveDir（Windows junction 安全删除）', () => {
  it('删除普通目录（含嵌套）', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dshw-safe-'))
    fs.mkdirSync(path.join(dir, 'a', 'b'), { recursive: true })
    fs.writeFileSync(path.join(dir, 'a', 'b', 'x.txt'), 'x')
    safeRemoveDir(dir)
    expect(fs.existsSync(dir)).toBe(false)
  })

  it('删除 junction 只删链接不删目标内容', () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'dshw-safe-'))
    const target = path.join(base, 'target')
    const holder = path.join(base, 'holder')
    fs.mkdirSync(target, { recursive: true })
    fs.writeFileSync(path.join(target, 'keep.txt'), 'keep')
    fs.mkdirSync(holder, { recursive: true })
    if (process.platform !== 'win32') return // junction 仅 Windows
    try {
      fs.symlinkSync(target, path.join(holder, 'link'), 'junction')
      expect(fs.existsSync(path.join(holder, 'link', 'keep.txt'))).toBe(true)
      safeRemoveDir(holder)
      expect(fs.existsSync(holder)).toBe(false)
      expect(fs.existsSync(path.join(target, 'keep.txt'))).toBe(true) // 目标内容保留
    } finally {
      fs.rmSync(base, { recursive: true, force: true })
    }
  })
})

describe('pickLatestLts（nodejs.org index.json 选版）', () => {
  it('取首个带 LTS 标记的版本（列表按新到旧）', () => {
    const entries = [
      { version: 'v24.19.0', lts: 'Krypton' },
      { version: 'v24.18.1', lts: 'Krypton' },
      { version: 'v23.0.0', lts: false },
      { version: 'v22.23.2', lts: 'Jod' }
    ]
    expect(pickLatestLts(entries)).toBe('v24.19.0')
  })

  it('跳过 lts=false 与缺失 lts 的版本', () => {
    const entries = [
      { version: 'v25.0.0', lts: false },
      { version: 'v24.19.0', lts: 'Krypton' },
      { version: 'v23.5.0' }
    ]
    expect(pickLatestLts(entries)).toBe('v24.19.0')
  })

  it('版本格式非法（非 vX.Y.Z）被跳过', () => {
    const entries = [
      { version: 'v24.19', lts: 'Krypton' },
      { version: 'nightly', lts: 'Krypton' },
      { version: 'v22.23.2', lts: 'Jod' }
    ]
    expect(pickLatestLts(entries)).toBe('v22.23.2')
  })

  it('无 LTS 版本返回 null', () => {
    expect(pickLatestLts([])).toBeNull()
    expect(pickLatestLts([{ version: 'v25.0.0', lts: false }])).toBeNull()
  })
})

describe('nodeZipUrl', () => {
  it('构造官方便携版 zip 直链', () => {
    expect(nodeZipUrl('v24.19.0')).toBe('https://nodejs.org/dist/v24.19.0/node-v24.19.0-win-x64.zip')
  })
})

describe('parsePortableGitVersionDir（镜像版本目录名解析）', () => {
  it('标准 windows 版本', () => {
    expect(parsePortableGitVersionDir('v2.51.1.windows.1')).toEqual({ major: 2, minor: 51, patch: 1, windows: 1 })
  })

  it('容忍结尾斜杠', () => {
    expect(parsePortableGitVersionDir('v2.14.4.windows.6/')).toEqual({ major: 2, minor: 14, patch: 4, windows: 6 })
  })

  it('无 windows 后缀按 0 处理', () => {
    expect(parsePortableGitVersionDir('2.47.1')).toEqual({ major: 2, minor: 47, patch: 1, windows: 0 })
  })

  it('非法目录名返回 null', () => {
    expect(parsePortableGitVersionDir('untagged-8231769e9b878a01c378')).toBeNull()
    expect(parsePortableGitVersionDir('v2.11.1.mingit-prerelease.4')).toBeNull()
    expect(parsePortableGitVersionDir('')).toBeNull()
    expect(parsePortableGitVersionDir(null as unknown as string)).toBeNull()
  })
})

describe('compareGitVersions', () => {
  it('按 major/minor/patch/windows 排序', () => {
    const a = parsePortableGitVersionDir('v2.47.1.windows.1')!
    const b = parsePortableGitVersionDir('v2.51.1.windows.1')!
    const c = parsePortableGitVersionDir('v2.51.1')!
    expect(compareGitVersions(a, b)).toBeLessThan(0)
    expect(compareGitVersions(b, c)).toBeGreaterThan(0)
    expect(compareGitVersions(c, c)).toBe(0)
  })
})

describe('PORTABLE_GIT_ASSET_RE（PortableGit 资产名匹配）', () => {
  it('匹配 x64 自解压包（新旧命名）', () => {
    expect(PORTABLE_GIT_ASSET_RE.test('PortableGit-2.51.1-64-bit.7z.exe')).toBe(true)
    expect(PORTABLE_GIT_ASSET_RE.test('PortableGit-2.47.1.windows.1-64-bit.7z.exe')).toBe(true)
  })

  it('拒绝非 x64 或非安装包', () => {
    expect(PORTABLE_GIT_ASSET_RE.test('PortableGit-2.51.1-arm64.7z.exe')).toBe(false)
    expect(PORTABLE_GIT_ASSET_RE.test('PortableGit-2.51.1-64-bit.7z.exe.sig')).toBe(false)
    expect(PORTABLE_GIT_ASSET_RE.test('MinGit-2.51.1-64-bit.zip')).toBe(false)
  })
})

describe('超时约定（规格 0.5）', () => {
  it('检测类 30s，安装/更新类 600s', () => {
    expect(DETECT_TIMEOUT_MS).toBe(30000)
    expect(INSTALL_TIMEOUT_MS).toBe(600000)
  })
})

describe('错误类型', () => {
  it('安装错误与取消错误可区分', () => {
    const err = new InstallError('下载失败')
    const cancelled = new InstallCancelledError()
    expect(err.name).toBe('InstallError')
    expect(cancelled.name).toBe('InstallCancelledError')
    expect(cancelled.message).toBe('安装已取消')
  })
})

describe('打包内置便携环境（P3）', () => {
  function makeEnvDir(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dshw-env-'))
    return dir
  }

  it('readEnvManifest：解析清单；缺失/损坏返回 null', () => {
    const dir = makeEnvDir()
    expect(readEnvManifest(dir)).toBeNull()
    fs.writeFileSync(path.join(dir, 'env-manifest.json'), '{bad json')
    expect(readEnvManifest(dir)).toBeNull()
    fs.writeFileSync(path.join(dir, 'env-manifest.json'), JSON.stringify({ node: { version: 'v24.0.0', archive: 'n.zip' } }))
    expect((readEnvManifest(dir)?.node as { version?: string } | undefined)?.version).toBe('v24.0.0')
  })

  it('verifySha256 / sha256Of：哈希匹配判定', () => {
    const file = path.join(makeEnvDir(), 'a.bin')
    fs.writeFileSync(file, 'hello')
    const hash = sha256Of(file)
    expect(verifySha256(file, hash)).toBe(true)
    expect(verifySha256(file, hash.toUpperCase())).toBe(true)
    expect(verifySha256(file, '0'.repeat(64))).toBe(false)
    expect(verifySha256(path.join(makeEnvDir(), 'missing.bin'), hash)).toBe(false)
    expect(verifySha256(file, undefined)).toBe(false)
  })

  it('bundledArchive：按清单解析归档；缺失返回 null', () => {
    const dir = makeEnvDir()
    fs.writeFileSync(path.join(dir, 'node-v24.0.0-win-x64.zip'), 'x')
    fs.writeFileSync(
      path.join(dir, 'env-manifest.json'),
      JSON.stringify({ node: { version: 'v24.0.0', archive: 'node-v24.0.0-win-x64.zip', sha256: sha256Of(path.join(dir, 'node-v24.0.0-win-x64.zip')) } })
    )
    const node = bundledArchive(dir, 'node')
    expect(node?.version).toBe('v24.0.0')
    expect(fs.existsSync(node?.archivePath ?? '')).toBe(true)
    // 清单里没有 git → null
    expect(bundledArchive(dir, 'git')).toBeNull()
    // 归档文件缺失 → null
    fs.writeFileSync(path.join(dir, 'env-manifest.json'), JSON.stringify({ dsh: { version: '1.0.0', archive: 'no-such.tgz' } }))
    expect(bundledArchive(dir, 'dsh')).toBeNull()
  })

  it('findGitRoot：识别 MinGit 带前缀的 git 根目录', () => {
    const staging = makeEnvDir()
    const root = path.join(staging, 'MinGit-2.51.1-64-bit')
    fs.mkdirSync(path.join(root, 'cmd'), { recursive: true })
    fs.writeFileSync(path.join(root, 'cmd', 'git.exe'), 'x')
    expect(findGitRoot(staging)).toBe(root)
    // 无 git.exe → null
    const empty = makeEnvDir()
    fs.mkdirSync(path.join(empty, 'cmd'))
    expect(findGitRoot(empty)).toBeNull()
  })
})

describe('内置便携环境端到端（真实内置包）', () => {
  it('runInstall node 使用内置环境完成安装（免下载、复制/解压、验证、替换）', async () => {
    const envDir = path.join(process.cwd(), 'resources', 'portable-env')
    if (!fs.existsSync(path.join(envDir, 'env-manifest.json'))) {
      // 未生成内置包（未执行 prepare:env）时跳过，避免 CI 假失败
      return
    }
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'dshw-env-e2e-'))
    const logs: string[] = []
    const prev = process.env.DSH_PORTABLE_ENV_DIR
    process.env.DSH_PORTABLE_ENV_DIR = envDir
    try {
      const { runInstall } = await import('../installer')
      const result = await runInstall(ws, 'node', 'install', {
        log: (m) => logs.push(m),
        progress: () => undefined
      })
      expect(result.ok).toBe(true)
      expect(fs.existsSync(path.join(ws, 'runtime', 'node', 'node.exe'))).toBe(true)
      expect(logs.some((l) => l.includes('使用内置便携环境'))).toBe(true)
      expect(logs.some((l) => l.includes('校验通过'))).toBe(true)
    } finally {
      fs.rmSync(ws, { recursive: true, force: true })
      if (prev === undefined) delete process.env.DSH_PORTABLE_ENV_DIR
      else process.env.DSH_PORTABLE_ENV_DIR = prev
    }
  }, 120000)
})
