import { defineStore } from 'pinia'
import { ElMessage } from 'element-plus'
import type { SessionEntry } from '../../../shared/ipc'

export const useSessionsStore = defineStore('sessions', {
  state: () => ({
    entries: [] as SessionEntry[],
    search: '',
    loading: false,
    selectedId: null as string | null
  }),
  getters: {
    filtered(state): SessionEntry[] {
      const keyword = state.search.trim().toLowerCase()
      if (!keyword) return state.entries
      return state.entries.filter((e) => e.title.toLowerCase().includes(keyword))
    }
  },
  actions: {
    async refresh(): Promise<void> {
      this.loading = true
      try {
        this.entries = await window.dshw.listSessions()
      } finally {
        this.loading = false
      }
    },
    async togglePin(entry: SessionEntry): Promise<void> {
      await window.dshw.pinSession(entry.id, !entry.pinned)
      await this.refresh()
    },
    async remove(entry: SessionEntry): Promise<void> {
      try {
        const result = await window.dshw.deleteSession(entry.id)
        if (!result.ok) {
          ElMessage.error(result.error ?? '删除失败')
          return
        }
        ElMessage.success('会话已删除')
        await this.refresh()
      } catch (error) {
        ElMessage.error(error instanceof Error ? error.message : String(error))
      }
    }
  }
})

/** 会话时间展示（今天显示时分，否则月-日）。 */
export function formatSessionTime(time: number): string {
  const d = new Date(time)
  const now = new Date()
  const sameDay = d.toDateString() === now.toDateString()
  const pad = (n: number): string => String(n).padStart(2, '0')
  if (sameDay) return `${pad(d.getHours())}:${pad(d.getMinutes())}`
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
