/** 完整安装包 manifest/状态层；没有真实安装器资产时必须明确报告，不伪装为已安装。 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

export interface InstallerAsset {
  key: 'node' | 'pnpm' | 'git' | 'dsh'
  version: string
  file: string
  silentArgs: string[]
  sha256?: string
}

export interface InstallerManifest {
  version: 1
  platform: string
  arch: string
  assets: InstallerAsset[]
}

export interface InstallStatus {
  version: 1
  updatedAt: string
  items: Record<string, { state: 'installed' | 'failed'; version?: string; source: 'bundled-installer' | 'online' | 'system'; error?: string }>
}

export function installerManifestPath(resourcesDir: string): string {
  return path.join(resourcesDir, 'bundled-env', 'install-manifest.json')
}

export function readInstallerManifest(resourcesDir: string): InstallerManifest | null {
  try {
    const value = JSON.parse(fs.readFileSync(installerManifestPath(resourcesDir), 'utf8')) as InstallerManifest
    if (value?.version !== 1 || !Array.isArray(value.assets)) return null
    return value
  } catch {
    return null
  }
}

export function writeInstallStatus(workspaceDir: string, status: InstallStatus): void {
  const dir = path.join(workspaceDir, 'env')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'install-status.json'), JSON.stringify(status, null, 2) + '\n', 'utf8')
}

export function readInstallStatus(workspaceDir: string): InstallStatus | null {
  try {
    return JSON.parse(fs.readFileSync(path.join(workspaceDir, 'env', 'install-status.json'), 'utf8')) as InstallStatus
  } catch {
    return null
  }
}

export function installerAssetHash(file: string): string {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}
