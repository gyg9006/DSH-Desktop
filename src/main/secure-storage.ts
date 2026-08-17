/**
 * API Key 加密存储（Electron safeStorage）：
 * - 加密后 base64 落盘 <workspace>/config/secure-keys.json（键 = provider id / 路由名）；
 * - 渲染层永远拿不到明文：明文只在主进程内解密后使用（测试连接 / 请求转发）；
 * - safeStorage 不可用时（Linux 无 keyring）降级为进程内内存持有（不落盘明文）。
 */
import { safeStorage } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { readJsonFile, writeJsonAtomic } from '../shared/workspace'
import { logger } from './logger'

interface SecureKeysFile {
  version: number
  /** providerId -> base64(加密后的 key) */
  keys: Record<string, string>
}

function keysFile(workspaceDir: string): string {
  return path.join(workspaceDir, 'config', 'secure-keys.json')
}

function readKeys(workspaceDir: string): Record<string, string> {
  const raw = readJsonFile(keysFile(workspaceDir))
  if (!raw || typeof raw !== 'object') return {}
  const keys = (raw as SecureKeysFile).keys
  return keys && typeof keys === 'object' ? keys : {}
}

function writeKeys(workspaceDir: string, keys: Record<string, string>): void {
  writeJsonAtomic(keysFile(workspaceDir), { version: 1, keys })
}

export function isEncryptionAvailable(): boolean {
  try {
    return safeStorage.isEncryptionAvailable()
  } catch {
    return false
  }
}

/** 内存兜底（safeStorage 不可用时）：进程内持有，绝不明文落盘。 */
const memoryFallback = new Map<string, string>()

/** 加密保存 Key（渲染层只传明文给主进程，落盘为密文）。 */
export function saveApiKeySecure(workspaceDir: string, providerId: string, plainKey: string): void {
  const trimmed = plainKey.trim()
  const keys = readKeys(workspaceDir)
  if (!trimmed) {
    delete keys[providerId]
    memoryFallback.delete(providerId)
    writeKeys(workspaceDir, keys)
    return
  }
  if (isEncryptionAvailable()) {
    keys[providerId] = safeStorage.encryptString(trimmed).toString('base64')
    writeKeys(workspaceDir, keys)
  } else {
    memoryFallback.set(providerId, trimmed)
    logger.warn('safeStorage 不可用，Key 仅内存持有（不落盘）')
  }
}

/** 解密读取 Key（仅供主进程内部使用，绝不暴露给渲染层明文）。 */
export function readApiKeySecure(workspaceDir: string, providerId: string): string | undefined {
  const keys = readKeys(workspaceDir)
  const enc = keys[providerId]
  if (!enc) return memoryFallback.get(providerId)
  try {
    if (isEncryptionAvailable()) {
      return safeStorage.decryptString(Buffer.from(enc, 'base64'))
    }
    // 加密不可用但历史有密文：无法解密
    logger.warn('safeStorage 不可用，无法解密已保存的 Key')
    return undefined
  } catch (error) {
    logger.warn(`Key 解密失败（${providerId}）：${String(error)}`)
    return undefined
  }
}

/** 掩码展示（sk-****abcd），供 UI 判断是否已配置。 */
export function maskKey(plain: string): string {
  if (!plain) return ''
  if (plain.length <= 8) return '****'
  return `${plain.slice(0, 3)}****${plain.slice(-4)}`
}

/** 删除 Key。 */
export function deleteApiKeySecure(workspaceDir: string, providerId: string): void {
  const keys = readKeys(workspaceDir)
  delete keys[providerId]
  memoryFallback.delete(providerId)
  writeKeys(workspaceDir, keys)
}

/** 检查是否已配置 Key（主进程侧，不返回明文）。 */
export function hasApiKeySecure(workspaceDir: string, providerId: string): boolean {
  return readApiKeySecure(workspaceDir, providerId) !== undefined
}

export function isSecureKeysFileExists(workspaceDir: string): boolean {
  return fs.existsSync(keysFile(workspaceDir))
}
