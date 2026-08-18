import { useCallback, useEffect, useRef, useState } from 'react'
import type { JSX } from 'react'
import {
  Cpu,
  Plug,
  Power,
  DatabaseBackup,
  RefreshCw,
  GitBranch,
  Loader2,
  CheckCircle2,
  XCircle,
  Upload,
  Download,
  AlertTriangle,
  Settings2,
  ScanSearch,
  ArrowUpCircle,
  ArrowDownCircle,
  GitMerge,
  Terminal,
  Trash2
} from 'lucide-react'
import type {
  BackupSettingsPayload,
  EnvItem,
  InstallKey,
  LogsPayload,
  SyncConfigPayload,
  SyncFileItem,
  SyncMode,
  SyncPreviewPayload,
  SyncSettingsPayload
} from '@shared/ipc'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../ui/card'
import { Button } from '../../ui/button'
import { Input } from '../../ui/input'
import { Switch } from '../../ui/switch'
import { Badge } from '../../ui/badge'
import { useToast } from '../../ui/toast'
import { cn } from '../../../lib/utils'

/** 高级配置：环境检测 / 服务 / 自动备份 / 智能同步 / 日志（模型与 API 已独立为「模型与 API」子菜单）。 */
export function AdvancedSection(): JSX.Element {
  return (
    <div className="max-w-2xl space-y-4">
      <EnvCard />
      <ServiceCard />
      <BackupCard />
      <SmartSyncCard />
      <LogsCard />
    </div>
  )
}

function EnvCard(): JSX.Element {
  const [items, setItems] = useState<EnvItem[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [updating, setUpdating] = useState<InstallKey | null>(null)
  const [progress, setProgress] = useState<number | null>(null)
  const [installLog, setInstallLog] = useState('')

  const detect = async (): Promise<void> => {
    setBusy(true)
    try {
      const report = await window.dshw.detectEnv()
      setItems(report.items)
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    void detect()
    const unsubscribe = window.dshw.onInstallEvent((event) => {
      if (event.phase === 'log') setInstallLog((prev) => (prev + '\n' + (event.message ?? '')).slice(-800))
      else if (event.phase === 'progress') setProgress(event.percent ?? null)
      else if (event.phase === 'done' || event.phase === 'error' || event.phase === 'cancelled') {
        setUpdating(null)
        setProgress(null)
        void detect()
      }
    })
    return unsubscribe
  }, [])

  const install = async (key: InstallKey, mode: 'install' | 'update'): Promise<void> => {
    const label = key === 'dsh' ? 'DeepSeek Harness（dsh）' : key
    if (mode === 'update' && !confirm(`一键更新 ${label} 到最新版？将下载便携版安装包并替换。`)) return
    setUpdating(key)
    setProgress(0)
    setInstallLog('')
    const result = await window.dshw.runInstall(key, mode)
    if (!result.ok && !result.cancelled) {
      setInstallLog((prev) => (prev + '\n' + (result.error ?? (mode === 'install' ? '安装失败' : '更新失败'))).slice(-800))
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Cpu className="h-4 w-4 text-cyber-neon" /> 环境检测
        </CardTitle>
        <CardDescription>Node / npm / pnpm / Git / dsh 运行时状态，支持一键更新到最新版。</CardDescription>
      </CardHeader>
      <CardContent className="space-y-1.5">
        {(items ?? []).map((item) => (
          <div key={item.key} className="flex items-center justify-between gap-2 rounded-lg border border-cyber-border bg-cyber-panel2 px-3 py-2">
            <span className="flex items-center gap-2 text-xs text-cyber-text">
              {item.state === 'ok' ? (
                <CheckCircle2 className="h-3.5 w-3.5 text-cyber-green" />
              ) : (
                <XCircle className="h-3.5 w-3.5 text-cyber-red" />
              )}
              {item.name}
            </span>
            <span className="flex items-center gap-2">
              <span className="font-mono text-[11px] text-cyber-dim">
                {item.version ?? '未安装'}
                {item.source === 'bundled' && ' · [内置]'}
                {item.source === 'portable' && ' · [工作区]'}
                {item.source === 'system' && ' · [系统]'}
              </span>
              <Badge variant={item.state === 'ok' ? 'green' : 'red'} className="px-1.5 text-[10px]">
                {item.state === 'ok' ? '就绪' : item.state === 'missing' ? '缺失' : '异常'}
              </Badge>
              {item.state === 'missing' ? (
                <Button
                  size="sm"
                  variant="default"
                  className="h-6 px-2 text-[10px]"
                  onClick={() => void install(item.key, 'install')}
                  disabled={updating !== null}
                  title={item.bundledAvailable ? '使用客户端内置便携环境，免下载' : '从网络下载便携版安装'}
                >
                  {updating === item.key ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />}
                  {item.bundledAvailable ? '启用内置环境' : '一键安装'}
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-6 px-2 text-[10px]"
                  onClick={() => void install(item.key, 'update')}
                  disabled={updating !== null}
                >
                  {updating === item.key ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                  更新
                </Button>
              )}
            </span>
          </div>
        ))}
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => void detect()} disabled={busy}>
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} 重新检测
          </Button>
          {updating && progress !== null && (
            <div className="flex flex-1 items-center gap-2">
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-cyber-panel2">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-cyber-neon to-cyber-violet transition-all"
                  style={{ width: `${Math.max(0, Math.min(100, progress))}%` }}
                />
              </div>
              <span className="font-mono text-[10px] text-cyber-neon">{progress}%</span>
            </div>
          )}
        </div>
        {installLog && (
          <pre className="max-h-28 overflow-y-auto whitespace-pre-wrap rounded-lg border border-cyber-border bg-cyber-bg p-2 font-mono text-[10px] leading-relaxed text-cyber-green">
            {installLog}
          </pre>
        )}
      </CardContent>
    </Card>
  )
}

/** 轻量 Tooltip：悬停 300ms 显示、移出 200ms 消失，样式沿用项目 cyber 主题。 */
function Tip({ text, children }: { text: string; children: React.ReactNode }): JSX.Element {
  const [show, setShow] = useState(false)
  const openTimer = useRef<number | undefined>(undefined)
  const closeTimer = useRef<number | undefined>(undefined)
  const enter = (): void => {
    if (closeTimer.current) window.clearTimeout(closeTimer.current)
    openTimer.current = window.setTimeout(() => setShow(true), 300)
  }
  const leave = (): void => {
    if (openTimer.current) window.clearTimeout(openTimer.current)
    closeTimer.current = window.setTimeout(() => setShow(false), 200)
  }
  return (
    <span className="relative inline-flex" onMouseEnter={enter} onMouseLeave={leave}>
      {children}
      {show && (
        <span className="pointer-events-none absolute left-1/2 top-full z-50 mt-1.5 -translate-x-1/2 whitespace-nowrap rounded-md border border-cyber-border bg-cyber-panel px-2 py-1 text-[10px] text-cyber-text shadow-lg">
          {text}
        </span>
      )}
    </span>
  )
}

function ServiceCard(): JSX.Element {
  const [portMode, setPortMode] = useState<'auto' | 'fixed'>('auto')
  const [port, setPort] = useState('3080')
  const [autoStart, setAutoStart] = useState(false)
  const [useSystemDsh, setUseSystemDsh] = useState(false)

  useEffect(() => {
    void window.dshw.getConfig().then((cfg) => {
      const svc = (cfg.service ?? {}) as { portMode?: 'auto' | 'fixed'; port?: number; autoStart?: boolean; useSystemDsh?: boolean }
      setPortMode(svc.portMode ?? 'auto')
      setPort(String(svc.port ?? 3080))
      setAutoStart(svc.autoStart === true)
      setUseSystemDsh(svc.useSystemDsh === true)
    })
  }, [])

  // 端口模式保存：显式传 mode/port（避免 setState 异步导致闭包读到旧值而保存失效）
  const savePort = async (mode: 'auto' | 'fixed', p?: string): Promise<void> => {
    await window.dshw.updateConfig({
      service: {
        portMode: mode,
        port: mode === 'fixed' ? Number(p ?? port) || 3080 : undefined
      }
    })
  }

  const saveAutoStart = async (enabled: boolean): Promise<void> => {
    setAutoStart(enabled)
    await window.dshw.setLoginItem(enabled)
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Plug className="h-4 w-4 text-cyber-neon" /> 服务与运行
        </CardTitle>
        <CardDescription>dsh 服务端口模式与开机自启。</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center gap-2">
          <Tip text="自动探测：自动寻找可用端口，避免冲突">
            <Badge
              variant={portMode === 'auto' ? 'default' : 'outline'}
              className="cursor-pointer"
              onClick={() => {
                setPortMode('auto')
                void savePort('auto')
              }}
            >
              自动探测
            </Badge>
          </Tip>
          <Tip text="固定端口：手动指定端口号，适用于已部署固定端口的场景">
            <Badge
              variant={portMode === 'fixed' ? 'default' : 'outline'}
              className="cursor-pointer"
              onClick={() => {
                setPortMode('fixed')
                void savePort('fixed')
              }}
            >
              固定端口
            </Badge>
          </Tip>
          {portMode === 'fixed' && (
            <>
              <Input value={port} onChange={(e) => setPort(e.target.value.replace(/\D/g, ''))} className="h-7 w-24 font-mono text-xs" />
              <Button size="sm" variant="outline" className="h-7" onClick={() => void savePort('fixed')}>保存</Button>
            </>
          )}
          <div className="flex-1" />
        </div>
        <div className="flex items-center justify-between rounded-lg border border-cyber-border bg-cyber-panel2 px-3 py-2">
          <span className="flex items-center gap-2 text-xs text-cyber-text">
            <Power className="h-3.5 w-3.5 text-cyber-neon" /> 开机自动启动 dsh 服务
          </span>
          <Switch checked={autoStart} onCheckedChange={(v) => void saveAutoStart(v)} />
        </div>
        <div className="flex items-center justify-between rounded-lg border border-cyber-border bg-cyber-panel2 px-3 py-2">
          <span className="flex items-center gap-2 text-xs text-cyber-text">
            <Terminal className="h-3.5 w-3.5 text-cyber-neon" /> 使用系统 dsh（正常版，跳过内置便携版）
          </span>
          <Switch
            checked={useSystemDsh}
            onCheckedChange={(v) => {
              setUseSystemDsh(v)
              void window.dshw.updateConfig({ service: { useSystemDsh: v } })
            }}
          />
        </div>
      </CardContent>
    </Card>
  )
}

function BackupCard(): JSX.Element {
  const [backup, setBackup] = useState<BackupSettingsPayload>({ enabled: false, period: 'daily', keep: 5 })

  useEffect(() => {
    void window.dshw.getBackupSettings().then(setBackup)
  }, [])

  const saveBackup = async (patch: Partial<BackupSettingsPayload>): Promise<void> => {
    const next = { ...backup, ...patch }
    setBackup(next)
    await window.dshw.setBackupSettings(next)
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <DatabaseBackup className="h-4 w-4 text-cyber-neon" /> 自动备份
        </CardTitle>
        <CardDescription>按周期把业务数据打包到 backups/，可随时恢复。</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-center justify-between rounded-lg border border-cyber-border bg-cyber-panel2 px-3 py-2">
          <span className="text-xs text-cyber-text">自动备份</span>
          <div className="flex items-center gap-3">
            <select
              value={backup.period ?? 'daily'}
              onChange={(e) => void saveBackup({ period: e.target.value as 'daily' | 'weekly' })}
              className="h-7 rounded-md border border-cyber-border bg-cyber-panel2 px-2 text-[11px] text-cyber-dim focus:outline-none"
            >
              <option value="daily">每天</option>
              <option value="weekly">每周</option>
            </select>
            <span className="text-[11px] text-cyber-faint">保留</span>
            <input
              type="number"
              min={1}
              max={30}
              value={backup.keep ?? 5}
              onChange={(e) => void saveBackup({ keep: Math.max(1, Number(e.target.value) || 1) })}
              className="h-7 w-14 rounded-md border border-cyber-border bg-cyber-panel2 px-2 text-[11px] text-cyber-text focus:outline-none"
            />
            <span className="text-[11px] text-cyber-faint">份</span>
            <Switch checked={backup.enabled === true} onCheckedChange={(v) => void saveBackup({ enabled: v })} />
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

const MODE_LABEL: Record<SyncMode, string> = {
  smart: '智能比对（谁新谁赢）',
  force: '强制覆盖',
  'add-only': '仅新增不覆盖'
}

function fmtTime(ms: number | null): string {
  if (ms === null || ms <= 0) return '—'
  return new Date(ms).toLocaleString('zh-CN', { hour12: false })
}

function fmtSize(bytes: number): string {
  if (bytes <= 0) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/** 智能同步卡片：远端配置 + 同步策略 + 预览面板（上传/下载/跳过/冲突 + 勾选执行）。 */
function SmartSyncCard(): JSX.Element {
  const { toast } = useToast()
  const [sync, setSync] = useState<SyncConfigPayload>({})
  const [settings, setSettings] = useState<SyncSettingsPayload>({})
  const [preview, setPreview] = useState<SyncPreviewPayload | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const [running, setRunning] = useState(false)
  const [uploadSel, setUploadSel] = useState<Set<string>>(new Set())
  const [downloadSel, setDownloadSel] = useState<Set<string>>(new Set())
  const [excludeText, setExcludeText] = useState('')
  const [autoSyncText, setAutoSyncText] = useState('')

  useEffect(() => {
    void window.dshw.getSyncConfig().then((r) => setSync(r.config))
    void window.dshw.getSyncSettings().then((s) => {
      setSettings(s)
      setExcludeText((s.exclude ?? []).join('\n'))
      setAutoSyncText(String(s.autoSyncMinutes ?? 0))
    })
    // 自动同步完成事件 → 提示并刷新预览
    const unsubscribe = window.dshw.onUiEvent((type) => {
      if (type === 'sync-completed') {
        toast('自动同步已完成', 'success')
        if (preview) void refreshPreview()
      }
    })
    return unsubscribe
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const refreshPreview = useCallback(async (mode?: SyncMode): Promise<void> => {
    setPreviewing(true)
    try {
      const result = await window.dshw.syncPreview(mode ?? settings.mode ?? 'smart')
      setPreview(result)
      if (!result.ok) {
        toast(result.error ?? '智能预览失败', 'error')
      } else {
        setUploadSel(new Set(result.items.filter((i) => i.status === 'upload').map((i) => i.rel)))
        setDownloadSel(new Set(result.items.filter((i) => i.status === 'download').map((i) => i.rel)))
      }
    } finally {
      setPreviewing(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.mode])

  const saveRemote = async (): Promise<void> => {
    const result = await window.dshw.setSyncConfig({ remoteUrl: sync.remoteUrl })
    toast(result.ok ? '同步远端已保存' : (result.error ?? '保存失败'), result.ok ? 'success' : 'error')
    if (result.ok) setSync(result.config ?? sync)
  }

  const savePolicy = async (): Promise<void> => {
    const result = await window.dshw.setSyncSettings({
      mode: settings.mode ?? 'smart',
      toleranceMs: settings.toleranceMs,
      exclude: excludeText.split('\n').map((s) => s.trim()).filter(Boolean),
      autoSyncMinutes: Number(autoSyncText) || 0
    })
    if (result.ok) {
      setSettings(result.settings ?? settings)
      toast('同步策略已保存', 'success')
    } else {
      toast(result.error ?? '保存失败', 'error')
    }
  }

  const runSync = async (direction: 'push' | 'pull'): Promise<void> => {
    const selection = direction === 'push' ? [...uploadSel] : [...downloadSel]
    if (selection.length === 0) {
      toast(direction === 'push' ? '没有勾选待上传的文件' : '没有勾选待下载的文件', 'info')
      return
    }
    setRunning(true)
    try {
      const result = await window.dshw.syncRun({ selection, direction, mode: settings.mode ?? 'smart' })
      if (result.ok) {
        const count = direction === 'push' ? (result.pushed ?? 0) : (result.pulled ?? 0)
        toast(
          count > 0
            ? (direction === 'push' ? `上传成功 ${count} 个文件` : `下载成功 ${count} 个文件`)
            : (direction === 'push' ? '远程已是最新，无需上传' : '本地已是最新，无需下载'),
          'success'
        )
        await refreshPreview()
      } else if (result.conflict) {
        toast(`${result.error ?? '同步冲突'}`, 'error')
      } else {
        toast(result.error ?? '同步失败', 'error')
      }
    } finally {
      setRunning(false)
    }
  }

  const resolveConflict = async (rel: string, choice: 'local' | 'remote'): Promise<void> => {
    setRunning(true)
    try {
      const result = await window.dshw.resolveSyncConflict(rel, choice)
      toast(result.ok ? `已${choice === 'local' ? '保留本地' : '使用远程'}：${rel}` : (result.error ?? '处理失败'), result.ok ? 'success' : 'error')
      await refreshPreview()
    } finally {
      setRunning(false)
    }
  }

  const toggle = (setter: React.Dispatch<React.SetStateAction<Set<string>>>, rel: string): void => {
    setter((prev) => {
      const next = new Set(prev)
      if (next.has(rel)) next.delete(rel)
      else next.add(rel)
      return next
    })
  }

  const mode = settings.mode ?? 'smart'
  const isForce = mode === 'force'
  const stats = preview?.ok ? preview.stats : null

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <GitBranch className="h-4 w-4 text-cyber-neon" /> 异地智能同步
        </CardTitle>
        <CardDescription>
          A/B 电脑间按「文件修改时间 vs 远端提交时间」智能比对：谁新谁赢，冲突三选一。凭据不会同步。
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* 远端仓库 */}
        <div className="flex items-center gap-2 rounded-lg border border-cyber-border bg-cyber-panel2 px-3 py-2">
          <GitBranch className="h-3.5 w-3.5 shrink-0 text-cyber-neon" />
          <Input
            placeholder="Git 远端地址（https://… 或 ssh://…）"
            value={sync.remoteUrl ?? ''}
            onChange={(e) => setSync({ ...sync, remoteUrl: e.target.value })}
            className="h-7 flex-1 font-mono text-xs"
          />
          <Button size="sm" variant="outline" className="h-7" onClick={() => void saveRemote()}>保存</Button>
        </div>

        {/* 同步策略 */}
        <div className="space-y-2 rounded-lg border border-cyber-border bg-cyber-panel2 p-3">
          <div className="flex items-center gap-2 text-xs text-cyber-text">
            <Settings2 className="h-3.5 w-3.5 text-cyber-neon" /> 同步策略
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={mode}
              onChange={(e) => setSettings({ ...settings, mode: e.target.value as SyncMode })}
              className="h-7 rounded-md border border-cyber-border bg-cyber-panel2 px-2 text-[11px] text-cyber-text focus:outline-none"
            >
              <option value="smart">智能比对（默认）</option>
              <option value="add-only">仅新增不覆盖</option>
              <option value="force">强制覆盖</option>
            </select>
            <span className="text-[11px] text-cyber-faint">时间容差</span>
            <input
              type="number"
              min={0}
              step={500}
              value={settings.toleranceMs ?? 2000}
              onChange={(e) => setSettings({ ...settings, toleranceMs: Math.max(0, Number(e.target.value) || 0) })}
              className="h-7 w-20 rounded-md border border-cyber-border bg-cyber-panel2 px-2 text-[11px] text-cyber-text focus:outline-none"
            />
            <span className="text-[11px] text-cyber-faint">ms</span>
            <span className="text-[11px] text-cyber-faint">自动同步</span>
            <input
              type="number"
              min={0}
              value={autoSyncText}
              onChange={(e) => setAutoSyncText(e.target.value)}
              className="h-7 w-16 rounded-md border border-cyber-border bg-cyber-panel2 px-2 text-[11px] text-cyber-text focus:outline-none"
            />
            <span className="text-[11px] text-cyber-faint">分钟（0=关）</span>
            <Button size="sm" variant="outline" className="h-7" onClick={() => void savePolicy()}>保存策略</Button>
          </div>
          <textarea
            placeholder="排除规则（.gitignore 语法，每行一条；如 data/sessions/archive*）"
            value={excludeText}
            onChange={(e) => setExcludeText(e.target.value)}
            rows={2}
            className="w-full rounded-md border border-cyber-border bg-cyber-bg px-2 py-1.5 font-mono text-[10px] text-cyber-text focus:outline-none"
          />
        </div>

        {/* 操作行 */}
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={() => void refreshPreview()} disabled={previewing || running || !sync.remoteUrl}>
            {previewing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ScanSearch className="h-3.5 w-3.5" />}
            智能预览
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => void runSync('push')}
            disabled={running || !sync.remoteUrl || !stats || stats.upload === 0 || isForce}
          >
            <ArrowUpCircle className="h-3.5 w-3.5" /> 上传选中{stats && stats.upload > 0 ? `（${uploadSel.size}/${stats.upload}）` : ''}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => void runSync('pull')}
            disabled={running || !sync.remoteUrl || !stats || stats.download === 0 || isForce}
          >
            <ArrowDownCircle className="h-3.5 w-3.5" /> 下载选中{stats && stats.download > 0 ? `（${downloadSel.size}/${stats.download}）` : ''}
          </Button>
          <div className="flex-1" />
          <span className="text-[11px] text-cyber-faint">{MODE_LABEL[mode]}</span>
          {isForce && (
            <span className="flex items-center gap-1 text-[11px] text-cyber-violet">
              <AlertTriangle className="h-3 w-3" /> 强制模式请用下方强推/强拉
            </span>
          )}
        </div>

        {/* 强制覆盖 */}
        <div className="flex items-center gap-2">
          <Button size="sm" variant="danger" className="h-6 text-[10px]" onClick={() => void window.dshw.syncForceRemote()} disabled={running || !sync.remoteUrl}>
            <Download className="h-3 w-3" /> 以远端为准（强拉）
          </Button>
          <Button size="sm" variant="danger" className="h-6 text-[10px]" onClick={() => void window.dshw.syncForceLocal()} disabled={running || !sync.remoteUrl}>
            <Upload className="h-3 w-3" /> 以本地为准（强推）
          </Button>
          <span className="text-[10px] text-cyber-faint">冲突兜底：整体覆盖</span>
        </div>

        {/* 预览结果 */}
        {preview && !preview.ok && (
          <div className="flex items-center gap-2 rounded-lg border border-cyber-red/40 bg-cyber-red/10 px-3 py-2 text-xs text-cyber-red">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            <span>{preview.error}</span>
            {/git|Git/i.test(preview.error ?? '') && (
              <span className="text-cyber-dim">请先在上方「环境检测」安装 Git 环境（便携版）后重试。</span>
            )}
          </div>
        )}

        {preview?.ok && stats && (
          <div className="space-y-2">
            <div className="flex items-center justify-between rounded-lg border border-cyber-border bg-cyber-panel2 px-3 py-2 text-[11px]">
              <span className="text-cyber-text">
                共 {stats.total} 个文件
                <span className="ml-2 text-cyber-green">📤 上传 {stats.upload}</span>
                <span className="ml-2 text-cyber-neon">📥 下载 {stats.download}</span>
                <span className="ml-2 text-cyber-dim">⏭️ 跳过 {stats.skip}</span>
                <span className="ml-2 text-cyber-violet">⚠️ 冲突 {stats.conflict}</span>
              </span>
              <Badge variant="outline" className="px-1.5 text-[9px]">
                容差 {preview.toleranceMs}ms
              </Badge>
            </div>

            <SyncList
              title="📤 待上传"
              color="text-cyber-green"
              items={preview.items.filter((i) => i.status === 'upload')}
              selected={uploadSel}
              onToggle={(rel) => toggle(setUploadSel, rel)}
            />
            <SyncList
              title="📥 待下载"
              color="text-cyber-neon"
              items={preview.items.filter((i) => i.status === 'download')}
              selected={downloadSel}
              onToggle={(rel) => toggle(setDownloadSel, rel)}
            />
            {stats.conflict > 0 && (
              <div className="space-y-1 rounded-lg border border-cyber-violet/40 bg-cyber-violet/5 p-2">
                <div className="text-[11px] font-medium text-cyber-violet">⚠️ 冲突（双方在容差窗口内都有修改）</div>
                {preview.items
                  .filter((i) => i.status === 'conflict')
                  .map((i) => (
                    <div key={i.rel} className="flex items-center gap-2 rounded border border-cyber-border bg-cyber-panel2 px-2 py-1.5">
                      <GitMerge className="h-3 w-3 shrink-0 text-cyber-violet" />
                      <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-cyber-text" title={i.rel}>{i.rel}</span>
                      <Button size="sm" variant="outline" className="h-6 px-2 text-[10px]" disabled={running} onClick={() => void resolveConflict(i.rel, 'local')}>
                        保留本地
                      </Button>
                      <Button size="sm" variant="outline" className="h-6 px-2 text-[10px]" disabled={running} onClick={() => void resolveConflict(i.rel, 'remote')}>
                        使用远程
                      </Button>
                    </div>
                  ))}
                <div className="text-[10px] text-cyber-faint">手动合并：先在外部编辑该文件，再执行一次「上传选中」覆盖。</div>
              </div>
            )}
            {stats.skip > 0 && (
              <details className="rounded-lg border border-cyber-border bg-cyber-panel2 px-3 py-2">
                <summary className="cursor-pointer text-[11px] text-cyber-dim">⏭️ 已跳过 {stats.skip} 个（内容一致或未变化）</summary>
                <div className="mt-1 max-h-32 overflow-y-auto space-y-0.5">
                  {preview.items.filter((i) => i.status === 'skip').map((i) => (
                    <div key={i.rel} className="truncate font-mono text-[10px] text-cyber-faint" title={i.rel}>
                      {i.rel} {i.reason ? `· ${i.reason}` : ''}
                    </div>
                  ))}
                </div>
              </details>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function SyncList(props: {
  title: string
  color: string
  items: SyncFileItem[]
  selected: Set<string>
  onToggle: (rel: string) => void
}): JSX.Element | null {
  const { title, color, items, selected, onToggle } = props
  if (items.length === 0) return null
  return (
    <div className="space-y-1 rounded-lg border border-cyber-border bg-cyber-panel2 p-2">
      <div className={cn('text-[11px] font-medium', color)}>
        {title}（{items.length}）
      </div>
      <div className="max-h-40 overflow-y-auto space-y-0.5">
        {items.map((i) => (
          <label key={i.rel} className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 hover:bg-white/5">
            <input
              type="checkbox"
              checked={selected.has(i.rel)}
              onChange={() => onToggle(i.rel)}
              className="h-3 w-3 shrink-0 accent-cyber-neon"
            />
            <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-cyber-text" title={i.rel}>{i.rel}</span>
            <span className="shrink-0 text-[9px] text-cyber-dim">
              {fmtTime(i.localTime)} → {fmtTime(i.remoteTime)}
            </span>
            {i.size > 0 && <span className="shrink-0 text-[9px] text-cyber-faint">{fmtSize(i.size)}</span>}
          </label>
        ))}
      </div>
    </div>
  )
}

/** 日志卡片：查看应用/服务日志、导出 zip、清空（排查启动/环境问题时导出并附上）。 */
function LogsCard(): JSX.Element {
  const { toast } = useToast()
  const [logs, setLogs] = useState<LogsPayload | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async (): Promise<void> => {
    setBusy(true)
    try {
      setLogs(await window.dshw.readLogs())
    } catch {
      setLogs(null)
    } finally {
      setBusy(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const exportLogs = async (): Promise<void> => {
    const r = await window.dshw.exportLogs()
    if (r.ok) toast('日志已导出为 zip', 'info')
    else if (!r.canceled) toast(r.error ?? '导出失败', 'error')
  }

  const clear = async (): Promise<void> => {
    if (!confirm('清空应用与 dsh 服务日志？')) return
    const r = await window.dshw.clearLogs()
    if (r.ok) {
      toast('日志已清空', 'info')
      void load()
    } else {
      toast(r.error ?? '清空失败', 'error')
    }
  }

  const lines: string[] = []
  if (logs) {
    for (const l of logs.dsh ?? []) lines.push(`[dsh] ${l}`)
    for (const l of logs.app ?? []) lines.push(`[app] ${l}`)
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Terminal className="h-4 w-4 text-cyber-neon" /> 日志
        </CardTitle>
        <CardDescription>应用与服务运行日志。服务/环境异常时点「导出日志」把 zip 发给支持排查。</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => void load()} disabled={busy}>
            {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />} 刷新
          </Button>
          <Button size="sm" variant="outline" onClick={() => void exportLogs()}>
            <Download className="h-3 w-3" /> 导出日志
          </Button>
          <Button size="sm" variant="ghost" onClick={() => void clear()}>
            <Trash2 className="h-3 w-3" /> 清空
          </Button>
        </div>
        <pre className="max-h-72 min-h-24 overflow-y-auto whitespace-pre-wrap rounded-lg border border-cyber-border bg-cyber-bg p-2 font-mono text-[10px] leading-relaxed text-cyber-dim">
          {lines.length > 0 ? lines.join('\n') : '（暂无日志）'}
        </pre>
      </CardContent>
    </Card>
  )
}
