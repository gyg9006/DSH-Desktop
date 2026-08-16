import { describe, expect, it } from 'vitest'
import {
  pickLatestLts,
  nodeZipUrl,
  parsePortableGitVersionDir,
  compareGitVersions,
  PORTABLE_GIT_ASSET_RE,
  INSTALL_TIMEOUT_MS,
  DETECT_TIMEOUT_MS,
  InstallError,
  InstallCancelledError
} from '../installer'

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
