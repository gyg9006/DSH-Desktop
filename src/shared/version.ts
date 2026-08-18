/**
 * 版本号解析与兼容性判断（纯函数，可单测）。
 * 被主进程 envCheck / installer 复用；渲染进程不直接使用。
 */

export interface ParsedVersion {
  major: number
  minor: number
  patch: number
  prerelease?: string
}

/**
 * 解析形如 "v22.11.0"、"18.20.4"、"git version 2.47.1.windows.1" 的版本字符串。
 * 取首个 x.y.z 三段；解析失败返回 null。
 */
export function parseVersion(input: unknown): ParsedVersion | null {
  if (typeof input !== 'string') return null
  const match = /^.*?v?(\d+)\.(\d+)\.(\d+)(?:[-+]([0-9A-Za-z.-]+))?.*$/.exec(input.trim())
  if (!match) return null
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4]
  }
}

/** 比较两个已解析版本：a < b 返回负数，a > b 返回正数，相等返回 0。 */
export function compareVersions(a: ParsedVersion, b: ParsedVersion): number {
  if (a.major !== b.major) return a.major - b.major
  if (a.minor !== b.minor) return a.minor - b.minor
  return a.patch - b.patch
}

export interface VersionRange {
  min?: ParsedVersion
  max?: ParsedVersion
}

/** 判断版本是否落在 [min, max] 区间内（端点含）。 */
export function isVersionInRange(v: ParsedVersion, range: VersionRange): boolean {
  if (range.min && compareVersions(v, range.min) < 0) return false
  if (range.max && compareVersions(v, range.max) > 0) return false
  return true
}

/**
 * dsh 官方未在 package.json 声明 engines（实测 Node 22/24 均可运行）。
 * 已与用户确认（M2 决策）：检测只设下限 >=18，不设上限；
 * 一键安装取最新 LTS（当前为 v24.x）。
 */
export const NODE_VERSION_RANGE: VersionRange = {
  min: { major: 18, minor: 0, patch: 0 }
}

export function isNodeVersionCompatible(version: string | null | undefined): boolean {
  const parsed = parseVersion(version)
  if (!parsed) return false
  return isVersionInRange(parsed, NODE_VERSION_RANGE)
}

/** 输出 "v22.11.0" 形式；解析失败返回原文（或 '未知'）。 */
export function formatVersionString(input: string | null | undefined): string {
  if (!input) return '未知'
  const parsed = parseVersion(input)
  if (!parsed) return input.trim()
  return `v${parsed.major}.${parsed.minor}.${parsed.patch}`
}
