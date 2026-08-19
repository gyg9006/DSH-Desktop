/**
 * 用户个性化配置保护：与 DSH runtime/app 更新隔离。
 * 快照位于 <workspace>/.dsh/backups/pre-update-<timestamp>/，更新只允许替换 app，
 * 不应触碰 user-profiles；更新后发现文件缺失时从快照恢复。
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

export interface CustomizationEntry {
  source: string
  profile: string
  kind: 'file' | 'directory'
  sha256?: string
}

export interface CustomizationManifest {
  version: 1
  createdAt: string
  entries: CustomizationEntry[]
}

const PROFILE_MAP: Array<{ source: string; profile: string }> = [
  { source: 'themes', profile: 'theme-custom' },
  { source: path.join('data', 'session-bg'), profile: 'session-bg-config' },
  { source: 'skills', profile: 'custom-skills' },
  { source: path.join('config', 'shortcuts.json'), profile: 'shortcuts.json' },
  { source: path.join('config', 'models.json'), profile: 'models.json' },
  { source: path.join('config', 'secure-keys.json'), profile: 'secure-keys.json' }
]

function sha256(file: string): string {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}

function copyEntry(workspaceDir: string, snapshotDir: string, source: string, profile: string): CustomizationEntry | null {
  const sourcePath = path.join(workspaceDir, source)
  if (!fs.existsSync(sourcePath)) return null
  const stat = fs.lstatSync(sourcePath)
  const target = path.join(snapshotDir, profile)
  if (stat.isDirectory()) {
    fs.cpSync(sourcePath, target, { recursive: true, dereference: false })
    return { source, profile, kind: 'directory' }
  }
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.copyFileSync(sourcePath, target)
  return { source, profile, kind: 'file', sha256: sha256(sourcePath) }
}

export function snapshotCustomizations(workspaceDir: string, timestamp = Date.now()): string {
  const dshDir = path.join(workspaceDir, '.dsh')
  const snapshotDir = path.join(dshDir, 'backups', `pre-update-${timestamp}`)
  fs.mkdirSync(snapshotDir, { recursive: true })
  const entries = PROFILE_MAP.map((x) => copyEntry(workspaceDir, snapshotDir, x.source, x.profile)).filter(Boolean) as CustomizationEntry[]
  const manifest: CustomizationManifest = { version: 1, createdAt: new Date(timestamp).toISOString(), entries }
  fs.writeFileSync(path.join(dshDir, 'user-customizations-manifest.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8')
  return snapshotDir
}

export function readCustomizationManifest(workspaceDir: string): CustomizationManifest | null {
  try {
    const p = path.join(workspaceDir, '.dsh', 'user-customizations-manifest.json')
    const value = JSON.parse(fs.readFileSync(p, 'utf8')) as CustomizationManifest
    return value && value.version === 1 && Array.isArray(value.entries) ? value : null
  } catch {
    return null
  }
}

export function restoreCustomizations(workspaceDir: string, snapshotDir: string): { ok: boolean; restored: string[]; error?: string } {
  const manifest = readCustomizationManifest(workspaceDir)
  if (!manifest) return { ok: false, restored: [], error: '个性化清单缺失或损坏' }
  const restored: string[] = []
  try {
    for (const entry of manifest.entries) {
      const target = path.join(workspaceDir, entry.source)
      const backup = path.join(snapshotDir, entry.profile)
      if (!fs.existsSync(backup)) continue
      if (fs.existsSync(target)) continue
      fs.mkdirSync(path.dirname(target), { recursive: true })
      if (entry.kind === 'directory') fs.cpSync(backup, target, { recursive: true, dereference: false })
      else fs.copyFileSync(backup, target)
      restored.push(entry.source)
    }
    return { ok: true, restored }
  } catch (error) {
    return { ok: false, restored, error: String(error) }
  }
}

export function verifyCustomizations(workspaceDir: string, snapshotDir?: string): { ok: boolean; missing: string[]; restored: string[] } {
  const manifest = readCustomizationManifest(workspaceDir)
  if (!manifest) return { ok: false, missing: ['.dsh/user-customizations-manifest.json'], restored: [] }
  const missing = manifest.entries.filter((e) => !fs.existsSync(path.join(workspaceDir, e.source))).map((e) => e.source)
  if (missing.length === 0) return { ok: true, missing: [], restored: [] }
  if (!snapshotDir) return { ok: false, missing, restored: [] }
  const result = restoreCustomizations(workspaceDir, snapshotDir)
  const remaining = missing.filter((p) => !result.restored.includes(p))
  return { ok: remaining.length === 0, missing: remaining, restored: result.restored }
}
