import { useCallback, useEffect, useMemo, useState } from 'react'
import type { JSX } from 'react'
import {
  FolderOpen,
  HardDrive,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Loader2,
  KeyRound,
  ArrowRight,
  ArrowLeft,
  RefreshCw,
  Server,
  PlugZap
} from 'lucide-react'
import type {
  EnvItemKey,
  EnvReport,
  InstallEvent,
  InstallMode,
  ModelsTestInput,
  ModelsViewPayload
} from '@shared/ipc'
import { Button } from '../ui/button'
import { Badge } from '../ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card'
import { Input } from '../ui/input'
import { Progress } from '../ui/progress'
import { useToast } from '../ui/toast'
import {
  allEnvOk,
  buildTestInput,
  envItemsNeedingAction,
  pickDefaultProvider,
  providerName
} from '../../lib/onboarding'

interface OnboardingWizardProps {
  onComplete: () => void
}

const ENV_NAMES: Record<EnvItemKey, string> = {
  node: 'Node.js',
  npm: 'npm',
  pnpm: 'pnpm',
  git: 'Git',
  dsh: 'DeepSeek Harness (dsh)'
}

type StepKey = 1 | 2 | 3

const STEP_META: Array<{ key: StepKey; title: string; desc: string; icon: typeof FolderOpen }> = [
  { key: 1, title: '工作文件夹', desc: '数据与配置的存放位置', icon: FolderOpen },
  { key: 2, title: '环境检测', desc: 'Node / npm / pnpm / Git / dsh', icon: HardDrive },
  { key: 3, title: 'API Key', desc: '配置至少一个模型厂商密钥', icon: KeyRound }
]

/**
 * 首次启动三步引导向导（独立渲染，不依赖 dsh 服务与业务配置）。
 * Step 1 工作文件夹 → Step 2 环境检测/一键安装 → Step 3 API Key 配置并测试。
 * 完成：写 onboarded:true → 自动启动 dsh 服务 → 进入主界面。
 */
export function OnboardingWizard({ onComplete }: OnboardingWizardProps): JSX.Element {
  const { toast } = useToast()
  const [step, setStep] = useState<StepKey>(1)

  // ---- Step 1：工作文件夹 ----
  const [workspacePath, setWorkspacePath] = useState('加载中…')
  const [relaunching, setRelaunching] = useState(false)

  // ---- Step 2：环境检测 ----
  const [env, setEnv] = useState<EnvReport | null>(null)
  const [installBusy, setInstallBusy] = useState<EnvItemKey | null>(null)
  const [installEvent, setInstallEvent] = useState<InstallEvent | null>(null)

  // ---- Step 3：API Key ----
  const [models, setModels] = useState<ModelsViewPayload | null>(null)
  const [providerId, setProviderId] = useState<string | null>(null)
  const [apiKey, setApiKey] = useState('')
  const [testing, setTesting] = useState(false)
  const [testedOk, setTestedOk] = useState<Record<string, number>>({})
  const [completing, setCompleting] = useState(false)

  // 进入某一步时加载对应数据
  useEffect(() => {
    if (step === 1) {
      void window.dshw.getWorkspaceInfo().then((info) => setWorkspacePath(info.workspacePath)).catch(() => setWorkspacePath('未知'))
    } else if (step === 2) {
      setEnv(null)
      setInstallEvent(null)
      void window.dshw.detectEnv().then(setEnv).catch(() => setEnv(null))
    } else if (step === 3) {
      setModels(null)
      setProviderId(null)
      void window.dshw
        .modelsGet()
        .then((view) => {
          setModels(view)
          setProviderId(pickDefaultProvider(view))
        })
        .catch(() => setModels(null))
    }
  }, [step])

  // 安装事件流订阅（挂载一次）
  useEffect(() => {
    return window.dshw.onInstallEvent((event) => setInstallEvent(event))
  }, [])

  const reloadEnv = useCallback((): void => {
    setInstallEvent(null)
    void window.dshw.detectEnv().then(setEnv).catch(() => setEnv(null))
  }, [])

  // ---- Step 1 操作 ----
  const chooseWorkspace = useCallback(async (): Promise<void> => {
    const chosen = await window.dshw.chooseWorkspaceFolder()
    if (!chosen.ok || chosen.canceled || !chosen.path) return
    if (chosen.path === workspacePath) return
    const result = await window.dshw.setWorkspacePath(chosen.path)
    if (!result.ok) {
      toast(result.error ?? '工作文件夹设置失败', 'error')
      return
    }
    toast('工作文件夹已更改，正在重启应用生效…', 'info')
    setRelaunching(true)
    window.setTimeout(() => {
      void window.dshw.relaunchApp().catch(() => setRelaunching(false))
    }, 1500)
  }, [workspacePath, toast])

  // ---- Step 2 操作 ----
  const runInstall = useCallback(
    async (key: EnvItemKey, mode: InstallMode): Promise<void> => {
      setInstallBusy(key)
      setInstallEvent(null)
      const result = await window.dshw.runInstall(key, mode)
      setInstallBusy(null)
      if (!result.ok) {
        toast(result.error ?? (result.cancelled ? '安装已取消' : '安装失败'), result.cancelled ? 'info' : 'error')
      }
      reloadEnv()
    },
    [reloadEnv, toast]
  )

  const installModeFor = (key: EnvItemKey): InstallMode => {
    const item = env?.items.find((i) => i.key === key)
    return item?.state === 'incompatible' ? 'update' : 'install'
  }

  const envNeedsAction = useMemo(() => envItemsNeedingAction(env), [env])
  const step2Ready = allEnvOk(env)

  // ---- Step 3 操作 ----
  const selectedPreset = useMemo(
    () => models?.presets.find((p) => p.id === providerId),
    [models, providerId]
  )

  const saveAndTest = useCallback(
    async (withKey: boolean): Promise<void> => {
      if (!providerId) return
      setTesting(true)
      try {
        if (withKey && apiKey.trim()) {
          const saved = await window.dshw.modelsKeySave(providerId, apiKey.trim())
          if (!saved.ok) {
            toast(saved.error ?? 'Key 保存失败', 'error')
            return
          }
        }
        const input: ModelsTestInput | null = buildTestInput(providerId, selectedPreset)
        if (!input) {
          toast('提供方预设缺失，无法测试', 'error')
          return
        }
        const result = await window.dshw.modelsTest(input)
        if (result.ok) {
          setTestedOk((prev) => ({ ...prev, [providerId]: result.latencyMs ?? 0 }))
          toast(
            `连接成功${result.latencyMs !== undefined ? `（${result.latencyMs}ms）` : ''}：${providerName(selectedPreset, providerId)}`,
            'success'
          )
        } else {
          toast(result.error ?? '连接测试失败', 'error')
        }
      } finally {
        setTesting(false)
      }
    },
    [providerId, selectedPreset, apiKey, toast]
  )

  const step3Ready = Object.keys(testedOk).length > 0

  const complete = useCallback(async (): Promise<void> => {
    setCompleting(true)
    try {
      const saved = await window.dshw.updateConfig({ onboarded: true })
      if (!saved.ok) {
        toast(saved.error ?? '保存配置失败', 'error')
        setCompleting(false)
        return
      }
      const started = await window.dshw.startService()
      if (!started.ok) {
        toast(`dsh 服务启动失败：${started.error ?? '未知错误'}（可稍后在底部状态栏重试）`, 'error')
      }
      onComplete()
    } catch (error) {
      toast(`引导完成处理失败：${String(error)}`, 'error')
      setCompleting(false)
    }
  }, [toast, onComplete])

  const envStateOf = (key: EnvItemKey): { state: string; version: string | null; source: string; bundledAvailable: boolean } => {
    const item = env?.items.find((i) => i.key === key)
    return {
      state: item?.state ?? 'error',
      version: item?.version ?? null,
      source: item?.source ?? 'none',
      bundledAvailable: item?.bundledAvailable ?? false
    }
  }

  return (
    <div className="scan-line flex h-full flex-col items-center justify-center overflow-y-auto bg-cyber-bg px-6 py-8">
      <div className="w-full max-w-xl">
        {/* 品牌头 */}
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-cyber-neon to-cyber-violet text-xl font-black text-cyber-bg shadow-glow-neon">
            D
          </div>
          <h1 className="neon-text text-xl font-bold">DSH 桌面 · 首次启动引导</h1>
          <p className="mt-1 text-xs text-cyber-dim">三步完成基础配置，即可进入 DeepSeek Harness 工作台</p>
        </div>

        {/* 步骤指示 */}
        <div className="mb-5 flex items-center justify-center gap-2">
          {STEP_META.map((meta, idx) => {
            const Icon = meta.icon
            const active = step === meta.key
            const done = step > meta.key
            return (
              <div key={meta.key} className="flex items-center gap-2">
                {idx > 0 && <div className={`h-px w-8 ${done || active ? 'bg-cyber-neon/60' : 'bg-cyber-faint/40'}`} />}
                <div
                  className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs transition-all ${
                    active
                      ? 'glow-border border-cyber-neon/60 bg-cyber-neon/10 text-cyber-neon'
                      : done
                        ? 'border-cyber-green/50 bg-cyber-green/10 text-cyber-green'
                        : 'border-cyber-border bg-cyber-panel text-cyber-dim'
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" />
                  <span>{meta.title}</span>
                  {done && <CheckCircle2 className="h-3 w-3" />}
                </div>
              </div>
            )
          })}
        </div>

        <Card className="glow-border border-cyber-neon/30">
          <CardHeader>
            <CardTitle className="text-base">{STEP_META.find((m) => m.key === step)?.title}</CardTitle>
            <CardDescription>{STEP_META.find((m) => m.key === step)?.desc}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* ============ Step 1 工作文件夹 ============ */}
            {step === 1 && (
              <>
                <div className="rounded-lg border border-cyber-border bg-cyber-panel2 px-3 py-2.5 text-xs">
                  <div className="mb-1 flex items-center gap-1.5 text-cyber-dim">
                    <HardDrive className="h-3.5 w-3.5" /> 当前工作文件夹
                  </div>
                  <div className="break-all font-mono text-cyber-text">{workspacePath}</div>
                </div>
                <p className="text-[11px] leading-relaxed text-cyber-faint">
                  会话记录、知识库、技能、插件、配置与凭据全部保存在工作文件夹内。可以整文件夹迁移/同步到其他电脑。
                </p>
                <div className="flex items-center justify-between gap-2">
                  <Button size="sm" variant="outline" onClick={() => void chooseWorkspace()} disabled={relaunching}>
                    {relaunching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FolderOpen className="h-3.5 w-3.5" />}
                    更改位置…
                  </Button>
                  <Button size="sm" onClick={() => setStep(2)} disabled={relaunching || workspacePath === '加载中…'}>
                    使用此路径并继续 <ArrowRight className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </>
            )}

            {/* ============ Step 2 环境检测 ============ */}
            {step === 2 && (
              <>
                <div className="space-y-2">
                  {(Object.keys(ENV_NAMES) as EnvItemKey[]).map((key) => {
                    const { state, version, source, bundledAvailable } = envStateOf(key)
                    const busy = installBusy === key
                    return (
                      <div key={key} className="flex items-center gap-3 rounded-lg border border-cyber-border bg-cyber-panel px-3 py-2.5">
                        <span className="shrink-0">
                          {busy ? (
                            <Loader2 className="h-4 w-4 animate-spin text-cyber-neon" />
                          ) : state === 'ok' ? (
                            <CheckCircle2 className="h-4 w-4 text-cyber-green" />
                          ) : state === 'incompatible' ? (
                            <AlertTriangle className="h-4 w-4 text-cyber-violet" />
                          ) : (
                            <XCircle className="h-4 w-4 text-cyber-red" />
                          )}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="text-xs font-medium text-cyber-text">{ENV_NAMES[key]}</div>
                          <div className="text-[10px] text-cyber-dim">
                            {version ?? (state === 'ok' ? '已安装' : '未安装')}
                            {source === 'bundled' && ' · [内置]'}
                            {source === 'portable' && ' · [工作区]'}
                            {source === 'system' && ' · [系统]'}
                          </div>
                          {busy && installEvent && (
                            <div className="mt-1.5 space-y-1">
                              <div className="text-[10px] text-cyber-neon">{installEvent.message ?? '处理中…'}</div>
                              {installEvent.percent !== undefined && installEvent.percent !== null && (
                                <Progress value={installEvent.percent} className="h-1.5" />
                              )}
                            </div>
                          )}
                        </div>
                        {!busy && state !== 'ok' && (
                          <Button
                            size="sm"
                            variant={state === 'incompatible' ? 'violet' : 'default'}
                            onClick={() => void runInstall(key, installModeFor(key))}
                            title={bundledAvailable && state === 'missing' ? '使用客户端内置便携环境，免下载' : undefined}
                          >
                            <PlugZap className="h-3.5 w-3.5" />
                            {state === 'incompatible' ? '更新' : bundledAvailable ? '启用内置环境' : '一键安装'}
                          </Button>
                        )}
                        {busy && (
                          <Button size="sm" variant="ghost" onClick={() => void window.dshw.cancelInstall()}>
                            取消
                          </Button>
                        )}
                      </div>
                    )
                  })}
                </div>
                {envNeedsAction.length > 0 && (
                  <p className="text-[11px] text-cyber-faint">
                    以下组件需要安装或更新：{envNeedsAction.map((k) => ENV_NAMES[k]).join('、')}。全部通过后才能继续。
                  </p>
                )}
                <div className="flex items-center justify-between gap-2">
                  <Button size="sm" variant="ghost" onClick={() => setStep(1)}>
                    <ArrowLeft className="h-3.5 w-3.5" /> 上一步
                  </Button>
                  <div className="flex items-center gap-2">
                    <Button size="sm" variant="ghost" onClick={reloadEnv} disabled={installBusy !== null}>
                      <RefreshCw className="h-3.5 w-3.5" /> 重新检测
                    </Button>
                    <Button size="sm" onClick={() => setStep(3)} disabled={!step2Ready}>
                      下一步 <ArrowRight className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              </>
            )}

            {/* ============ Step 3 API Key ============ */}
            {step === 3 && (
              <>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {(models?.presets ?? []).map((p) => (
                    <button
                      key={p.id}
                      onClick={() => {
                        setProviderId(p.id)
                        setApiKey('')
                      }}
                      className={`rounded-lg border p-2.5 text-left transition-all ${
                        providerId === p.id
                          ? 'glow-border border-cyber-neon/60 bg-cyber-neon/10'
                          : 'border-cyber-border bg-cyber-panel hover:border-cyber-neon/40'
                      }`}
                    >
                      <div className="text-xs font-medium text-cyber-text">{p.name}</div>
                      <div className="mt-0.5 text-[10px] text-cyber-dim">
                        {(models?.keyMasks[p.id] ?? '').length > 0 ? `已配置 ${models?.keyMasks[p.id]}` : p.keyRequired ? '需 API Key' : '可选'}
                      </div>
                    </button>
                  ))}
                  {(models?.presets ?? []).length === 0 && (
                    <div className="col-span-full text-xs text-cyber-dim">提供方列表加载失败，请检查网络后重试。</div>
                  )}
                </div>

                {selectedPreset && (
                  <div className="space-y-3 rounded-lg border border-cyber-border bg-cyber-panel2 p-3">
                    <div className="flex items-center gap-2 text-xs text-cyber-text">
                      <Server className="h-3.5 w-3.5 text-cyber-neon" />
                      {providerName(selectedPreset, providerId ?? '')} · {selectedPreset.baseUrl}
                      {testedOk[providerId ?? ''] !== undefined && (
                        <Badge variant="green" className="px-1.5 text-[9px]">
                          已通过 {testedOk[providerId ?? '']}ms
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <Input
                        type="password"
                        placeholder={(models?.keyMasks[providerId ?? ''] ?? '').length > 0 ? '已配置 Key（留空使用现有）' : '粘贴 API Key'}
                        value={apiKey}
                        onChange={(e) => setApiKey(e.target.value)}
                        disabled={testing}
                      />
                      <Button size="sm" onClick={() => void saveAndTest(true)} disabled={testing || !apiKey.trim()}>
                        {testing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <KeyRound className="h-3.5 w-3.5" />}
                        保存并测试
                      </Button>
                    </div>
                    {(models?.keyMasks[providerId ?? ''] ?? '').length > 0 && (
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[10px] text-cyber-dim">使用已保存的 Key 直接测试：</span>
                        <Button size="sm" variant="outline" onClick={() => void saveAndTest(false)} disabled={testing}>
                          测试现有 Key
                        </Button>
                      </div>
                    )}
                  </div>
                )}

                <p className="text-[11px] leading-relaxed text-cyber-faint">
                  至少一个模型厂商连接测试成功后才能完成引导。Key 仅保存在本机工作文件夹内。
                </p>
                <div className="flex items-center justify-between gap-2">
                  <Button size="sm" variant="ghost" onClick={() => setStep(2)}>
                    <ArrowLeft className="h-3.5 w-3.5" /> 上一步
                  </Button>
                  <Button size="sm" variant="success" onClick={() => void complete()} disabled={!step3Ready || completing}>
                    {completing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                    完成，进入工作台
                  </Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        <p className="mt-4 text-center text-[10px] text-cyber-faint">
          引导页独立渲染，不依赖 dsh 服务；可随时通过「设置 → 通用 → 工作文件夹」更改。
        </p>
      </div>
    </div>
  )
}
