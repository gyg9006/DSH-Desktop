import { useEffect, useState } from 'react'
import type { AppInfo } from '@shared/ipc'

let cached: AppInfo | null = null

/** 读取应用信息（进程内缓存，避免重复 IPC）。 */
export async function getAppInfo(): Promise<AppInfo> {
  if (cached) return cached
  cached = await window.dshw.getAppInfo()
  return cached
}

export function getAppVersion(): string {
  // 同步占位：App 挂载时用 hook 拉取并写入 data-version
  return typeof document !== 'undefined' ? (document.documentElement.dataset.appVersion ?? '2.0.0') : '2.0.0'
}

/** React hook：应用信息。 */
export function useAppInfo(): AppInfo | null {
  const [info, setInfo] = useState<AppInfo | null>(null)
  useEffect(() => {
    void getAppInfo().then((i) => {
      document.documentElement.dataset.appVersion = i.appVersion
      setInfo(i)
    })
  }, [])
  return info
}
