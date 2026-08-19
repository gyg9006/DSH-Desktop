import { useCallback, useEffect, useMemo, useState } from 'react'
import type { JSX } from 'react'
import { FolderOpen, HardDrive, CheckCircle2, XCircle, AlertTriangle, Loader2, ArrowRight, RefreshCw, PlugZap, SkipForward } from 'lucide-react'
import type { EnvItemKey, EnvReport, InstallEvent, InstallMode } from '@shared/ipc'
import { Button } from '../ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card'
import { Progress } from '../ui/progress'
import { useToast } from '../ui/toast'
import { allEnvOk, envItemsNeedingAction } from '../../lib/onboarding'

interface OnboardingWizardProps {
  appVersion: string
  onComplete: () => void
}

const ENV_NAMES: Record<EnvItemKey, string> = {
  node: 'Node.js',
  npm: 'npm',
  pnpm: 'pnpm',
  git: 'Git',
  dsh: 'DeepSeek Harness (dsh)'
}

type StepKey = 1 | 2
const STEP_META: Array<{ key: StepKey; title: string; desc: string; icon: typeof FolderOpen }> = [
  { key: 1, title: '工作文件夹', desc: 'DSH 配置、数据和日志的存放位置', icon: FolderOpen },
  { key: 2, title: '环境检测', desc: 'Node.js、Git、网络和 DSH 运行环境', icon: HardDrive }
]

/** 独立两步引导：只负责工作目录和运行环境，模型/API Key 由 DSH 原生服务管理。 */
export function OnboardingWizard({ appVersion, onComplete }: OnboardingWizardProps): JSX.Element {
  const { toast } = useToast()
  const [step, setStep] = useState<StepKey>(1)
  const [workspacePath, setWorkspacePath] = useState('加载中…')
  const [relaunching, setRelaunching] = useState(false)
  const [env, setEnv] = useState<EnvReport | null>(null)
  const [installBusy, setInstallBusy] = useState<EnvItemKey | null>(null)
  const [installEvent, setInstallEvent] = useState<InstallEvent | null>(null)
  const [completing, setCompleting] = useState(false)

  useEffect(() => {
    if (step === 1) {
      void window.dshw.getWorkspaceInfo().then((info) => setWorkspacePath(info.workspacePath)).catch(() => setWorkspacePath('未知'))
    } else {
      setEnv(null)
      setInstallEvent(null)
      void window.dshw.detectEnv().then(setEnv).catch(() => setEnv(null))
    }
  }, [step])

  useEffect(() => window.dshw.onInstallEvent((event) => setInstallEvent(event)), [])

  const reloadEnv = useCallback((): void => {
    setInstallEvent(null)
    void window.dshw.detectEnv().then(setEnv).catch(() => setEnv(null))
  }, [])

  const chooseWorkspace = useCallback(async (): Promise<void> => {
    const chosen = await window.dshw.chooseWorkspaceFolder()
    if (!chosen.ok || chosen.canceled || !chosen.path || chosen.path === workspacePath) return
    const result = await window.dshw.setWorkspacePath(chosen.path)
    if (!result.ok) { toast(result.error ?? '工作文件夹设置失败', 'error'); return }
    toast('工作文件夹已更改，正在重启应用生效…', 'info')
    setRelaunching(true)
    window.setTimeout(() => { void window.dshw.relaunchApp().catch(() => setRelaunching(false)) }, 1000)
  }, [workspacePath, toast])

  const runInstall = useCallback(async (key: EnvItemKey, mode: InstallMode): Promise<void> => {
    setInstallBusy(key)
    setInstallEvent(null)
    try {
      const result = await window.dshw.runInstall(key, mode)
      if (!result.ok) toast(result.error ?? (result.cancelled ? '安装已取消' : '安装失败'), result.cancelled ? 'info' : 'error')
    } finally {
      setInstallBusy(null)
      reloadEnv()
    }
  }, [reloadEnv, toast])

  const envNeedsAction = useMemo(() => envItemsNeedingAction(env), [env])
  const ready = allEnvOk(env)
  const envStateOf = (key: EnvItemKey) => {
    const item = env?.items.find((i) => i.key === key)
    return { state: item?.state ?? 'error', version: item?.version ?? null, source: item?.source ?? 'none', bundledAvailable: item?.bundledAvailable ?? false }
  }

  const finish = useCallback(async (): Promise<void> => {
    if (completing) return
    setCompleting(true)
    try {
      const saved = await window.dshw.updateConfig({ onboarded: true, onboardingVersion: appVersion })
      if (!saved.ok) { toast(saved.error ?? '保存引导状态失败', 'error'); return }
      const started = await window.dshw.startService()
      if (!started.ok) toast(`DSH 服务稍后启动：${started.error ?? '请在底部状态栏重试'}`, 'info')
      onComplete()
    } catch (error) {
      toast(`引导完成失败：${String(error)}`, 'error')
    } finally {
      setCompleting(false)
    }
  }, [appVersion, completing, onComplete, toast])

  const skip = useCallback(async (): Promise<void> => {
    if (completing) return
    setCompleting(true)
    try {
      const saved = await window.dshw.updateConfig({ onboarded: true, onboardingVersion: appVersion })
      if (!saved.ok) { toast(saved.error ?? '跳过引导失败', 'error'); return }
      onComplete()
    } finally {
      setCompleting(false)
    }
  }, [appVersion, completing, onComplete, toast])

  return (
    <div className="scan-line flex h-full flex-col items-center justify-center overflow-y-auto bg-cyber-bg px-6 py-8">
      <div className="w-full max-w-xl">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-cyber-neon to-cyber-violet text-xl font-black text-cyber-bg shadow-glow-neon">D</div>
          <h1 className="neon-text text-xl font-bold">DSH 桌面 · 首次启动引导</h1>
          <p className="mt-1 text-xs text-cyber-dim">两步完成工作目录和运行环境配置，核心功能由 DSH 完整服务提供</p>
        </div>
        <div className="mb-5 flex items-center justify-center gap-2">
          {STEP_META.map((meta, index) => {
            const Icon = meta.icon
            const active = step === meta.key
            const done = step > meta.key
            return <div key={meta.key} className="flex items-center gap-2">
              {index > 0 && <div className={`h-px w-8 ${done || active ? 'bg-cyber-neon/60' : 'bg-cyber-faint/40'}`} />}
              <div className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs ${active ? 'glow-border border-cyber-neon/60 bg-cyber-neon/10 text-cyber-neon' : done ? 'border-cyber-green/50 bg-cyber-green/10 text-cyber-green' : 'border-cyber-border bg-cyber-panel text-cyber-dim'}`}>
                <Icon className="h-3.5 w-3.5" /><span>{meta.title}</span>{done && <CheckCircle2 className="h-3 w-3" />}
              </div>
            </div>
          })}
        </div>
        <Card className="glow-border border-cyber-neon/30">
          <CardHeader><CardTitle className="text-base">{STEP_META.find((m) => m.key === step)?.title}</CardTitle><CardDescription>{STEP_META.find((m) => m.key === step)?.desc}</CardDescription></CardHeader>
          <CardContent className="space-y-4">
            {step === 1 && <>
              <div className="rounded-lg border border-cyber-border bg-cyber-panel2 px-3 py-2.5 text-xs"><div className="mb-1 flex items-center gap-1.5 text-cyber-dim"><HardDrive className="h-3.5 w-3.5" /> 当前 DSH 工作文件夹</div><div className="break-all font-mono text-cyber-text">{workspacePath}</div></div>
              <p className="text-[11px] leading-relaxed text-cyber-faint">DSH 原生服务将在此目录读写配置、会话、知识库、技能和日志。API Key 与模型配置请在 DSH 完整服务界面中管理。</p>
              <div className="flex items-center justify-between gap-2"><Button size="sm" variant="ghost" onClick={() => void skip()} disabled={completing}><SkipForward className="h-3.5 w-3.5" /> 跳过</Button><div className="flex items-center gap-2"><Button size="sm" variant="outline" onClick={() => void chooseWorkspace()} disabled={relaunching}><FolderOpen className="h-3.5 w-3.5" /> 更改位置…</Button><Button size="sm" onClick={() => setStep(2)} disabled={relaunching || workspacePath === '加载中…'}>下一步 <ArrowRight className="h-3.5 w-3.5" /></Button></div></div>
            </>}
            {step === 2 && <>
              <div className="space-y-2">{(Object.keys(ENV_NAMES) as EnvItemKey[]).map((key) => { const { state, version, source, bundledAvailable } = envStateOf(key); const busy = installBusy === key; return <div key={key} className="flex items-center gap-3 rounded-lg border border-cyber-border bg-cyber-panel px-3 py-2.5"><span>{busy ? <Loader2 className="h-4 w-4 animate-spin text-cyber-neon" /> : state === 'ok' ? <CheckCircle2 className="h-4 w-4 text-cyber-green" /> : state === 'incompatible' ? <AlertTriangle className="h-4 w-4 text-cyber-violet" /> : <XCircle className="h-4 w-4 text-cyber-red" />}</span><div className="min-w-0 flex-1"><div className="text-xs font-medium text-cyber-text">{ENV_NAMES[key]}</div><div className="text-[10px] text-cyber-dim">{version ?? (state === 'ok' ? '已安装' : '未安装')}{source === 'bundled' && ' · [内置]'}{source === 'portable' && ' · [工作区]'}{source === 'system' && ' · [系统]'}</div>{busy && installEvent && <div className="mt-1.5 space-y-1"><div className="text-[10px] text-cyber-neon">{installEvent.message ?? '处理中…'}</div>{installEvent.percent != null && <Progress value={installEvent.percent} className="h-1.5" />}</div>}</div>{!busy && state !== 'ok' && <Button size="sm" onClick={() => void runInstall(key, 'install')}><PlugZap className="h-3.5 w-3.5" /> {bundledAvailable ? '启用内置环境' : '一键安装'}</Button>}{busy && <Button size="sm" variant="ghost" onClick={() => void window.dshw.cancelInstall()}>取消</Button>}</div>})}</div>
              {envNeedsAction.length > 0 && <p className="text-[11px] text-cyber-faint">以下组件需要安装或更新：{envNeedsAction.map((key) => ENV_NAMES[key]).join('、')}</p>}
              <div className="flex items-center justify-between gap-2"><Button size="sm" variant="ghost" onClick={() => setStep(1)}>上一步</Button><div className="flex items-center gap-2"><Button size="sm" variant="ghost" onClick={() => void skip()} disabled={completing}><SkipForward className="h-3.5 w-3.5" /> 跳过</Button><Button size="sm" variant="ghost" onClick={reloadEnv} disabled={installBusy !== null}><RefreshCw className="h-3.5 w-3.5" /> 重新检测</Button><Button size="sm" variant="success" onClick={() => void finish()} disabled={!ready || completing}>{completing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />} 开始使用</Button></div></div>
            </>}
          </CardContent>
        </Card>
        <p className="mt-4 text-center text-[10px] text-cyber-faint">引导页独立渲染，不依赖 DSH 服务；模型/API Key 由 DSH 原生界面管理。</p>
      </div>
    </div>
  )
}
