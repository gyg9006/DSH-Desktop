import { useEffect, useState } from 'react'
import type { JSX } from 'react'
import { Cpu, Plug, Power, DatabaseBackup, RefreshCw, GitBranch, Loader2, CheckCircle2, XCircle } from 'lucide-react'
import type { BackupSettingsPayload, EnvItem, SyncConfigPayload } from '@shared/ipc'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../ui/card'
import { Button } from '../../ui/button'
import { Input } from '../../ui/input'
import { Switch } from '../../ui/switch'
import { Badge } from '../../ui/badge'
import { cn } from '../../../lib/utils'

/** 高级配置：环境检测 / 服务 / 开机自启 / 自动备份 / 异地同步（模型与 API 已独立为「模型与 API」子菜单）。 */
export function AdvancedSection(): JSX.Element {
  return (
    <div className="max-w-2xl space-y-4">
      <EnvCard />
      <ServiceCard />
      <BackupSyncCard />
    </div>
  )
}

function EnvCard(): JSX.Element {
  const [items, setItems] = useState<EnvItem[] | null>(null)
  const [busy, setBusy] = useState(false)

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
  }, [])

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Cpu className="h-4 w-4 text-cyber-neon" /> 环境检测
        </CardTitle>
        <CardDescription>Node / npm / pnpm / Git / dsh 运行时状态。</CardDescription>
      </CardHeader>
      <CardContent className="space-y-1.5">
        {(items ?? []).map((item) => (
          <div key={item.key} className="flex items-center justify-between rounded-lg border border-cyber-border bg-cyber-panel2 px-3 py-2">
            <span className="flex items-center gap-2 text-xs text-cyber-text">
              {item.state === 'ok' ? (
                <CheckCircle2 className="h-3.5 w-3.5 text-cyber-green" />
              ) : (
                <XCircle className="h-3.5 w-3.5 text-cyber-red" />
              )}
              {item.name}
            </span>
            <span className="flex items-center gap-2">
              <span className="font-mono text-[11px] text-cyber-dim">{item.version ?? '未安装'}</span>
              <Badge variant={item.state === 'ok' ? 'green' : 'red'} className="px-1.5 text-[10px]">
                {item.state === 'ok' ? '就绪' : item.state === 'missing' ? '缺失' : '异常'}
              </Badge>
            </span>
          </div>
        ))}
        <Button size="sm" variant="outline" onClick={() => void detect()} disabled={busy}>
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} 重新检测
        </Button>
      </CardContent>
    </Card>
  )
}

function ServiceCard(): JSX.Element {
  const [portMode, setPortMode] = useState<'auto' | 'fixed'>('auto')
  const [port, setPort] = useState('3080')
  const [autoStart, setAutoStart] = useState(false)

  useEffect(() => {
    void window.dshw.getConfig().then((cfg) => {
      const svc = (cfg.service ?? {}) as { portMode?: 'auto' | 'fixed'; port?: number; autoStart?: boolean }
      setPortMode(svc.portMode ?? 'auto')
      setPort(String(svc.port ?? 3080))
      setAutoStart(svc.autoStart === true)
    })
  }, [])

  const savePort = async (): Promise<void> => {
    await window.dshw.updateConfig({
      service: {
        portMode,
        port: portMode === 'fixed' ? Number(port) || 3080 : undefined
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
          <Badge variant="outline" className="cursor-pointer" onClick={() => { setPortMode('auto'); void savePort() }}>
            自动探测
          </Badge>
          <Badge variant="outline" className="cursor-pointer" onClick={() => { setPortMode('fixed'); void savePort() }}>
            固定端口
          </Badge>
          {portMode === 'fixed' && (
            <>
              <Input value={port} onChange={(e) => setPort(e.target.value.replace(/\D/g, ''))} className="h-7 w-24 font-mono text-xs" />
              <Button size="sm" variant="outline" className="h-7" onClick={() => void savePort()}>保存</Button>
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
      </CardContent>
    </Card>
  )
}

function BackupSyncCard(): JSX.Element {
  const [backup, setBackup] = useState<BackupSettingsPayload>({ enabled: false, period: 'daily', keep: 5 })
  const [sync, setSync] = useState<SyncConfigPayload>({})
  const [syncBusy, setSyncBusy] = useState(false)
  const [syncMsg, setSyncMsg] = useState('')

  useEffect(() => {
    void window.dshw.getBackupSettings().then(setBackup)
    void window.dshw.getSyncConfig().then((r) => setSync(r.config))
  }, [])

  const saveBackup = async (patch: Partial<BackupSettingsPayload>): Promise<void> => {
    const next = { ...backup, ...patch }
    setBackup(next)
    await window.dshw.setBackupSettings(next)
  }

  const doSync = async (dir: 'push' | 'pull'): Promise<void> => {
    setSyncBusy(true)
    try {
      const result = dir === 'push' ? await window.dshw.syncPush() : await window.dshw.syncPull()
      setSyncMsg(result.ok ? (result.conflict ? '同步冲突，请选择「以远端/本地为准」' : `同步完成（${dir === 'push' ? result.pushed : result.pulled} 条）`) : (result.error ?? '同步失败'))
    } finally {
      setSyncBusy(false)
    }
  }

  const saveSync = async (): Promise<void> => {
    const result = await window.dshw.setSyncConfig({ remoteUrl: sync.remoteUrl })
    setSyncMsg(result.ok ? '同步配置已保存' : (result.error ?? '保存失败'))
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <DatabaseBackup className="h-4 w-4 text-cyber-neon" /> 备份与异地同步
        </CardTitle>
        <CardDescription>自动备份策略与 A/B 电脑 Git 同步。</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
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

        <div className="flex items-center gap-2 rounded-lg border border-cyber-border bg-cyber-panel2 px-3 py-2">
          <GitBranch className="h-3.5 w-3.5 shrink-0 text-cyber-neon" />
          <Input
            placeholder="Git 远端地址（https://… 或 ssh://…）"
            value={sync.remoteUrl ?? ''}
            onChange={(e) => setSync({ ...sync, remoteUrl: e.target.value })}
            className="h-7 flex-1 font-mono text-xs"
          />
          <Button size="sm" variant="outline" className="h-7" onClick={() => void saveSync()}>保存</Button>
          <Button size="sm" variant="ghost" className="h-7" onClick={() => void doSync('pull')} disabled={syncBusy || !sync.remoteUrl}>
            <RefreshCw className={cn('h-3 w-3', syncBusy && 'animate-spin')} /> 下载
          </Button>
          <Button size="sm" variant="ghost" className="h-7" onClick={() => void doSync('push')} disabled={syncBusy || !sync.remoteUrl}>
            <RefreshCw className={cn('h-3 w-3', syncBusy && 'animate-spin')} /> 上传
          </Button>
        </div>
        {syncMsg && <div className="text-xs text-cyber-dim">{syncMsg}</div>}
      </CardContent>
    </Card>
  )
}
