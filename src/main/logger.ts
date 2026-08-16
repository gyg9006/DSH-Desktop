/**
 * 文件日志：写入 <workspace>/logs/app.log，超过 5MB 滚动为 app.log.1。
 * 渲染进程未捕获异常经由 IPC 上报到此处（全局错误边界）。
 */
import fs from 'node:fs'
import path from 'node:path'
import type { LogLevel } from '../shared/ipc'

const MAX_LOG_BYTES = 5 * 1024 * 1024

class Logger {
  private file: string | null = null
  /** 内存环形缓冲，供日志面板展示（M5 使用）。 */
  private ring: string[] = []

  init(dir: string): void {
    fs.mkdirSync(dir, { recursive: true })
    this.file = path.join(dir, 'app.log')
  }

  log(level: LogLevel, message: string, meta?: unknown): void {
    const line = this.format(level, message, meta)
    if (this.file) {
      try {
        this.rotateIfNeeded()
        fs.appendFileSync(this.file, line + '\n', 'utf8')
      } catch (error) {
        // 日志写入失败不应导致应用崩溃
        process.stderr.write(`[logger] 写入失败: ${String(error)}\n`)
      }
    }
    this.ring.push(line)
    if (this.ring.length > 500) this.ring.shift()
  }

  debug(message: string, meta?: unknown): void {
    this.log('debug', message, meta)
  }

  info(message: string, meta?: unknown): void {
    this.log('info', message, meta)
  }

  warn(message: string, meta?: unknown): void {
    this.log('warn', message, meta)
  }

  error(message: string, meta?: unknown): void {
    this.log('error', message, meta)
  }

  getRecentLines(max = 200): string[] {
    return this.ring.slice(-max)
  }

  getLogFilePath(): string | null {
    return this.file
  }

  private format(level: LogLevel, message: string, meta?: unknown): string {
    const time = new Date().toISOString()
    const suffix = meta === undefined ? '' : ` ${JSON.stringify(meta)}`
    return `${time} [${level.toUpperCase()}] ${message}${suffix}`
  }

  private rotateIfNeeded(): void {
    if (!this.file) return
    try {
      const stat = fs.statSync(this.file)
      if (stat.size < MAX_LOG_BYTES) return
      const backup = this.file + '.1'
      if (fs.existsSync(backup)) fs.unlinkSync(backup)
      fs.renameSync(this.file, backup)
      fs.writeFileSync(this.file, '', 'utf8')
    } catch {
      // 滚动失败不影响运行
    }
  }
}

export const logger = new Logger()
