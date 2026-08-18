/**
 * M5：日志读取/清空/导出（规格 6.26）。
 * 应用日志：logs/app.log（+ 滚动 app.log.1）；dsh 运行日志：logs/dsh.log（dshService 追加）。
 */
import fs from 'node:fs'
import path from 'node:path'
import { runCommand } from './utils/process'

const MAX_READ_BYTES = 2 * 1024 * 1024

function readTail(filePath: string, maxBytes: number): string[] {
  if (!fs.existsSync(filePath)) return []
  try {
    const stat = fs.statSync(filePath)
    const start = Math.max(0, stat.size - maxBytes)
    const fd = fs.openSync(filePath, 'r')
    const buf = Buffer.alloc(Math.min(stat.size, maxBytes))
    fs.readSync(fd, buf, 0, buf.length, start)
    fs.closeSync(fd)
    const text = buf.toString('utf8')
    const lines = text.split(/\r?\n/)
    if (start > 0) lines[0] = '…（截断）'
    return lines.filter(Boolean).slice(-2000)
  } catch {
    return []
  }
}

export function readAppLog(workspaceDir: string): string[] {
  return [
    ...readTail(path.join(workspaceDir, 'logs', 'app.log.1'), MAX_READ_BYTES),
    ...readTail(path.join(workspaceDir, 'logs', 'app.log'), MAX_READ_BYTES)
  ]
}

export function readDshLog(workspaceDir: string): string[] {
  return readTail(path.join(workspaceDir, 'logs', 'dsh.log'), MAX_READ_BYTES)
}

export function clearLogs(workspaceDir: string): { ok: boolean; error?: string } {
  try {
    for (const name of ['app.log', 'app.log.1', 'dsh.log']) {
      const full = path.join(workspaceDir, 'logs', name)
      if (fs.existsSync(full)) fs.writeFileSync(full, '', 'utf8')
    }
    return { ok: true }
  } catch (error) {
    return { ok: false, error: `清空失败：${error instanceof Error ? error.message : String(error)}` }
  }
}

/** 导出日志为 zip。 */
export async function exportLogsZip(
  workspaceDir: string,
  destPath: string
): Promise<{ ok: boolean; error?: string }> {
  const logsDir = path.join(workspaceDir, 'logs')
  const files = ['app.log', 'app.log.1', 'dsh.log'].filter((f) => fs.existsSync(path.join(logsDir, f)))
  if (files.length === 0) return { ok: false, error: '没有可导出的日志' }
  const result = await runCommand({
    command: 'tar',
    args: ['-a', '-cf', destPath, '-C', logsDir, ...files],
    timeoutMs: 60000
  })
  if (result.error) return { ok: false, error: `导出失败：${result.error}` }
  return { ok: true }
}
