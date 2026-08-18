import { useEffect, useState } from 'react'
import type { ServiceSnapshot } from '@shared/ipc'

/**
 * dsh 服务状态 hook：订阅主进程 ServiceEvent 广播，
 * 提供 start / stop / status / port。
 */
export interface DshServiceState {
  status: ServiceSnapshot['status']
  port: number | null
  pid: number | null
  log: string[]
  busy: boolean
  start: () => Promise<{ ok: boolean; error?: string }>
  stop: () => Promise<void>
  refresh: () => Promise<void>
}

export function useDshService(): DshServiceState {
  const [snapshot, setSnapshot] = useState<ServiceSnapshot>({ status: 'stopped', port: null, pid: null, log: [] })
  const [busy, setBusy] = useState(false)

  const refresh = async (): Promise<void> => {
    const snap = await window.dshw.getServiceStatus()
    setSnapshot(snap)
  }

  useEffect(() => {
    void refresh()
    const unsubscribe = window.dshw.onServiceEvent((snap) => setSnapshot(snap))
    return unsubscribe
  }, [])

  const start = async (): Promise<{ ok: boolean; error?: string }> => {
    setBusy(true)
    try {
      const result = await window.dshw.startService()
      await refresh()
      return { ok: result.ok, error: result.error }
    } finally {
      setBusy(false)
    }
  }

  const stop = async (): Promise<void> => {
    setBusy(true)
    try {
      await window.dshw.stopService()
      await refresh()
    } finally {
      setBusy(false)
    }
  }

  return { ...snapshot, busy, start, stop, refresh }
}
