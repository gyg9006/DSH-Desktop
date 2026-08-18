import { useCallback, useEffect, useRef, useState } from 'react'
import type { JSX } from 'react'
import { Download, RefreshCw, BellRing, FileText, Clock, Rocket, XCircle } from 'lucide-react'
import type { UpdateEventPayload, UpdateCheckResultPayload } from '@shared/ipc'
import { Button } from '../ui/button'
import { Progress } from '../ui/progress'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../ui/dialog'
import { useToast } from '../ui/toast'

interface NoticeState {
  version: string
  notes?: string
  url?: string
}

/**
 * 更新中心（需求一）：
 * - 订阅 UpdateEvent：发现新版本 → 右下角非阻断 Toast（[立即更新][稍后提醒][查看日志]）；
 * - [立即更新] → 更新进度窗口（下载/校验/应用阶段 + 进度条 + 取消）；
 * - 下载完成 → [重启应用并更新]（应用 update.bat 替换 app 目录）；
 * - [稍后提醒] → 记录 dismissedVersion，直到出现更新版本不再打扰；
 * - [查看日志] → 打开 Release 页面 / 显示更新说明。
 */
export function UpdateCenter(): JSX.Element | null {
  const { toast } = useToast()
  const [notice, setNotice] = useState<NoticeState | null>(null)
  const [phase, setPhase] = useState<UpdateEventPayload['phase'] | null>(null)
  const [percent, setPercent] = useState<number | null>(null)
  const [message, setMessage] = useState('')
  const [zipPath, setZipPath] = useState('')
  const [busy, setBusy] = useState(false)
  const notifiedVersion = useRef('')

  useEffect(() => {
    return window.dshw.onUpdateEvent((event) => {
      setPhase(event.phase)
      setPercent(event.percent ?? null)
      setMessage(event.message ?? '')
      if (event.phase === 'found') {
        // 防抖：同版本只弹一次（lastVersion 已在主进程写入）
        if (event.version && event.version === notifiedVersion.current) return
        if (event.version) notifiedVersion.current = event.version
        setNotice({ version: event.version ?? '', notes: event.error })
      } else if (event.phase === 'downloaded') {
        setNotice(null)
      } else if (event.phase === 'error') {
        setPhase(null)
      }
    })
  }, [])

  const beginDownload = useCallback(async (): Promise<void> => {
    setBusy(true)
    try {
      const check: UpdateCheckResultPayload = await window.dshw.checkUpdate()
      if (!check.ok || !check.hasUpdate || check.assetId === undefined) {
        toast(check.message ?? '当前已是最新版本', 'info')
        setNotice(null)
        return
      }
      setNotice(null)
      const result = await window.dshw.downloadUpdate(check.assetId)
      if (result.ok && result.path) {
        setZipPath(result.path)
        setPhase('downloaded')
        setMessage(`新版本已下载完成（${check.latest}）`)
      } else if (!result.canceled) {
        toast(result.error ?? '下载失败', 'error')
      }
    } finally {
      setBusy(false)
    }
  }, [toast])

  const snooze = useCallback(async (): Promise<void> => {
    if (notice?.version) {
      await window.dshw.setUpdateSettings({ dismissedVersion: notice.version })
    }
    setNotice(null)
  }, [notice])

  const viewLog = useCallback(async (): Promise<void> => {
    const check = await window.dshw.checkUpdate()
    if (check.ok && check.downloadUrl) {
      await window.dshw.openExternal(check.downloadUrl)
    } else if (notice?.notes) {
      toast(notice.notes, 'info')
    }
    setNotice(null)
  }, [notice, toast])

  const applyNow = useCallback(async (): Promise<void> => {
    if (!zipPath) return
    setBusy(true)
    const result = await window.dshw.applyUpdate(zipPath)
    setBusy(false)
    if (!result.ok) {
      toast(result.error ?? '应用更新失败', 'error')
      return
    }
    // update.bat 已写入：退出应用后由 bat 替换 app 目录并重启
    await window.dshw.windowClose()
  }, [zipPath, toast])

  const downloading = phase === 'downloading' || phase === 'checking'

  return (
    <>
      {/* 非阻断 Toast：发现新版本 */}
      {notice && (
        <div className="pointer-events-auto fixed bottom-14 right-4 z-[110] w-80 rounded-lg border border-cyber-neon/40 bg-cyber-bg/95 p-3 shadow-[0_8px_32px_rgba(0,0,0,0.5)] backdrop-blur">
          <div className="flex items-center gap-2 text-xs font-semibold text-cyber-neon">
            <BellRing className="h-3.5 w-3.5" /> 发现新版本 v{notice.version}
          </div>
          <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-cyber-dim">
            {notice.notes?.slice(0, 120) || '更新包已就绪，点击「立即更新」开始下载。'}
          </p>
          <div className="mt-2 flex items-center gap-1.5">
            <Button size="sm" className="h-6 px-2 text-[10px]" onClick={() => void beginDownload()} disabled={busy}>
              {busy ? <RefreshCw className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />} 立即更新
            </Button>
            <Button size="sm" variant="ghost" className="h-6 px-2 text-[10px]" onClick={() => void snooze()}>
              <Clock className="h-3 w-3" /> 稍后提醒
            </Button>
            <Button size="sm" variant="ghost" className="h-6 px-2 text-[10px]" onClick={() => void viewLog()}>
              <FileText className="h-3 w-3" /> 查看日志
            </Button>
          </div>
        </div>
      )}

      {/* 更新进度窗口 */}
      <Dialog open={downloading || phase === 'downloaded'} onOpenChange={(open) => { if (!open && phase !== 'downloaded') setPhase(null) }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              {phase === 'downloaded' ? <Rocket className="h-4 w-4 text-cyber-green" /> : <Download className="h-4 w-4 text-cyber-neon" />}
              {phase === 'downloaded' ? '更新包已下载' : '正在更新'}
            </DialogTitle>
            <DialogDescription>{message || '下载中…'}</DialogDescription>
          </DialogHeader>
          {phase !== 'downloaded' ? (
            <div className="space-y-2">
              <Progress value={percent ?? 0} />
              <div className="text-right font-mono text-[10px] text-cyber-neon">{percent ?? 0}%</div>
              <Button size="sm" variant="ghost" className="w-full" onClick={() => void window.dshw.cancelUpdateDownload()} disabled={!downloading}>
                <XCircle className="h-3.5 w-3.5" /> 取消下载
              </Button>
            </div>
          ) : (
            <Button size="sm" variant="default" className="w-full" onClick={() => void applyNow()} disabled={busy}>
              <Rocket className="h-3.5 w-3.5" /> 重启应用并更新
            </Button>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
