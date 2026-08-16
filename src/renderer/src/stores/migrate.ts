import { defineStore } from 'pinia'
import type { DshDataItemKey, DshDataSource, MigrateConflictPolicy, MigrateEvent, MigrateResult } from '../../../shared/ipc'

export type MigrateStatus = 'idle' | 'running' | 'done' | 'error' | 'cancelled'

export const useMigrateStore = defineStore('migrate', {
  state: () => ({
    sources: [] as DshDataSource[],
    scanning: false,
    running: false,
    progress: null as { done: number; total: number } | null,
    logs: [] as string[],
    status: 'idle' as MigrateStatus,
    result: null as MigrateResult | null
  }),
  actions: {
    init(): void {
      window.dshw.onMigrateEvent((event) => {
        if (event.phase === 'log' && event.message) this.pushLog(event.message)
        else if (event.phase === 'progress' && event.done !== undefined && event.total !== undefined) {
          this.progress = { done: event.done, total: event.total }
        }
      })
    },
    pushLog(line: string): void {
      this.logs.push(line)
      if (this.logs.length > 1000) this.logs.splice(0, this.logs.length - 1000)
    },
    async scan(): Promise<void> {
      this.scanning = true
      try {
        this.sources = await window.dshw.scanDshData()
      } finally {
        this.scanning = false
      }
    },
    async run(
      sourceHome: string,
      selection: DshDataItemKey[],
      conflictPolicy: MigrateConflictPolicy
    ): Promise<MigrateResult> {
      this.running = true
      this.status = 'running'
      this.progress = null
      this.logs = []
      this.result = null
      let result: MigrateResult
      try {
        result = await window.dshw.runMigration(sourceHome, selection, conflictPolicy)
      } catch (error) {
        result = { ok: false, error: error instanceof Error ? error.message : String(error), copied: 0, skipped: 0, renamed: 0, overwritten: 0 }
      }
      this.result = result
      this.status = result.cancelled ? 'cancelled' : result.ok ? 'done' : 'error'
      if (result.error) this.pushLog(`迁移失败：${result.error}`)
      this.running = false
      return result
    },
    async cancel(): Promise<void> {
      if (!this.running) return
      this.pushLog('正在取消…')
      await window.dshw.cancelMigration()
    },
    clear(): void {
      this.logs = []
      this.progress = null
      this.status = 'idle'
      this.result = null
    }
  }
})
