import { defineStore } from 'pinia'
import type { ServiceSnapshot, ServiceStatus } from '../../../shared/ipc'

export const useServiceStore = defineStore('service', {
  state: () => ({
    status: 'stopped' as ServiceStatus,
    port: null as number | null,
    pid: null as number | null,
    log: [] as string[],
    starting: false,
    stopping: false
  }),
  actions: {
    init(): void {
      window.dshw.onServiceEvent((snapshot) => this.applySnapshot(snapshot))
      void this.refresh().catch(() => undefined)
    },
    applySnapshot(snapshot: ServiceSnapshot): void {
      this.status = snapshot.status
      this.port = snapshot.port
      this.pid = snapshot.pid
      this.log = snapshot.log
    },
    async refresh(): Promise<void> {
      try {
        const snapshot = await window.dshw.getServiceStatus()
        this.applySnapshot(snapshot)
      } catch (error) {
        // IPC 失败保持当前状态，不产生 unhandled rejection
        console.warn('[service] 刷新状态失败', error)
      }
    },
    async start(): Promise<{ ok: boolean; error?: string }> {
      if (this.starting || this.stopping) return { ok: false, error: '操作进行中' }
      this.starting = true
      try {
        const result = await window.dshw.startService()
        return result
      } finally {
        this.starting = false
        await this.refresh()
      }
    },
    async stop(): Promise<{ ok: boolean }> {
      if (this.starting || this.stopping) return { ok: false }
      this.stopping = true
      try {
        return await window.dshw.stopService()
      } finally {
        this.stopping = false
        await this.refresh()
      }
    }
  }
})
