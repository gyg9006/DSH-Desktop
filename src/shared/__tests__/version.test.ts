import { describe, expect, it } from 'vitest'
import {
  parseVersion,
  compareVersions,
  isVersionInRange,
  isNodeVersionCompatible,
  formatVersionString,
  NODE_VERSION_RANGE
} from '../version'

describe('parseVersion', () => {
  it('解析标准 v 前缀版本', () => {
    expect(parseVersion('v22.11.0')).toEqual({ major: 22, minor: 11, patch: 0 })
  })

  it('解析无前缀版本', () => {
    expect(parseVersion('18.20.4')).toEqual({ major: 18, minor: 20, patch: 4 })
  })

  it('从带前缀文本中提取版本（如 git --version 输出）', () => {
    expect(parseVersion('git version 2.47.1.windows.1')).toEqual({ major: 2, minor: 47, patch: 1 })
    expect(parseVersion('pnpm version 9.15.0')).toEqual({ major: 9, minor: 15, patch: 0 })
  })

  it('解析预发布版本', () => {
    const parsed = parseVersion('0.1.0-rc.6')
    expect(parsed).toEqual({ major: 0, minor: 1, patch: 0, prerelease: 'rc.6' })
  })

  it('非法输入返回 null', () => {
    expect(parseVersion('')).toBeNull()
    expect(parseVersion('abc')).toBeNull()
    expect(parseVersion(null)).toBeNull()
    expect(parseVersion(undefined)).toBeNull()
    expect(parseVersion(123 as unknown as string)).toBeNull()
  })
})

describe('compareVersions', () => {
  it('按 major/minor/patch 逐段比较', () => {
    const a = parseVersion('18.20.4')!
    const b = parseVersion('22.11.0')!
    const c = parseVersion('22.11.1')!
    expect(compareVersions(a, b)).toBeLessThan(0)
    expect(compareVersions(b, c)).toBeLessThan(0)
    expect(compareVersions(c, b)).toBeGreaterThan(0)
    expect(compareVersions(b, parseVersion('22.11.0')!)).toBe(0)
  })
})

describe('isNodeVersionInRange（已确认决策：>=18 无上限）', () => {
  it('18 为下界，包含端点', () => {
    expect(isVersionInRange(parseVersion('18.0.0')!, NODE_VERSION_RANGE)).toBe(true)
    expect(isVersionInRange(parseVersion('17.9.0')!, NODE_VERSION_RANGE)).toBe(false)
  })

  it('无上限：22/23/24/25 均兼容', () => {
    expect(isVersionInRange(parseVersion('22.11.0')!, NODE_VERSION_RANGE)).toBe(true)
    expect(isVersionInRange(parseVersion('23.0.0')!, NODE_VERSION_RANGE)).toBe(true)
    expect(isVersionInRange(parseVersion('24.19.0')!, NODE_VERSION_RANGE)).toBe(true)
    expect(isVersionInRange(parseVersion('25.0.0')!, NODE_VERSION_RANGE)).toBe(true)
  })
})

describe('isNodeVersionCompatible（>=18）', () => {
  it('18 及以上版本兼容', () => {
    expect(isNodeVersionCompatible('v18.0.0')).toBe(true)
    expect(isNodeVersionCompatible('v22.11.0')).toBe(true)
    expect(isNodeVersionCompatible('v24.19.0')).toBe(true)
  })

  it('低于 18 不兼容', () => {
    expect(isNodeVersionCompatible('v17.9.0')).toBe(false)
    expect(isNodeVersionCompatible('v16.20.2')).toBe(false)
  })

  it('无法解析的版本不兼容', () => {
    expect(isNodeVersionCompatible(null)).toBe(false)
    expect(isNodeVersionCompatible('')).toBe(false)
    expect(isNodeVersionCompatible('garbage')).toBe(false)
  })
})

describe('formatVersionString', () => {
  it('标准化输出', () => {
    expect(formatVersionString('v22.11.0')).toBe('v22.11.0')
    expect(formatVersionString('22.11.0')).toBe('v22.11.0')
  })

  it('非法输入回退', () => {
    expect(formatVersionString(null)).toBe('未知')
    expect(formatVersionString('')).toBe('未知')
  })
})
