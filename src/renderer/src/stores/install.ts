import { defineStore } from 'pinia'
import type { InstallEvent, InstallKey, InstallMode } from '../../../shared/ipc'

export type InstallStatus = 'idle' | 'running' | 'done' | 'error' | 'cancelled'

export const INSTALL_KEY_LABELS: Record<InstallKey, string> = {
  node: 'Node.js',
  npm: 'npm',
  pnpm: 'pnpm',
  git: 'Git',
  dsh: 'DeepSeek Harness (dsh)'
}

export const useInstallStore = defineStore('install', {
  state: () => ({
    running: false,
    currentKey: null as InstallKey | null,
    mode: null as InstallMode | null,
    progress: null as number | null,
    logs: [] as string[],
    status: 'idle' as InstallStatus,
    error: null as string | null
  }),
  actions: {
    /** 订阅主进程事件流（App 启动时调用一次）。 */
    init(): void {
      window.dshw.onInstallEvent((event) => {
        if (event.phase === 'log' && event.message) this.pushLog(event.message)
        else if (event.phase === 'progress') this.progress = event.percent ?? null
      })
    },
    pushLog(line: string): void {
      this.logs.push(line)
      if (this.logs.length > 2000) this.logs.splice(0, this.logs.length - 2000)
    },
    /** 启动一项安装/更新任务，等待其完成。 */
    async run(key: InstallKey, mode: InstallMode): Promise<{ ok: boolean; cancelled?: boolean; error?: string }> {
      if (this.running) return { ok: false, error: '已有任务进行中' }
      this.running = true
      this.currentKey = key
      this.mode = mode
      this.status = 'running'
      this.error = null
      this.progress = null
      this.logs = []
      this.pushLog(`任务开始：${INSTALL_KEY_LABELS[key]}（${mode === 'update' ? '更新' : '安装'}）`)

      let result: { ok: boolean; error?: string; cancelled?: boolean }
      try {
        result = await window.dshw.runInstall(key, mode)
      } catch (error) {
        result = { ok: false, error: error instanceof Error ? error.message : String(error) }
      }

      if (result.cancelled) {
        this.status = 'cancelled'
        this.pushLog('任务已取消')
      } else if (result.ok) {
        this.status = 'done'
        this.pushLog('任务完成')
      } else {
        this.status = 'error'
        this.error = result.error ?? '未知错误'
        this.pushLog(`任务失败：${this.error}`)
      }
      this.running = false
      return result
    },
    async cancel(): Promise<void> {
      if (!this.running) return
      this.pushLog('正在取消…')
      await window.dshw.cancelInstall()
    },
    async copyError(): Promise<void> {
      if (this.error) await window.dshw.writeClipboard(this.error)
    },
    clear(): void {
      this.logs = []
      this.error = null
      this.status = 'idle'
      this.progress = null
      this.currentKey = null
      this.mode = null
    }
  }
})
