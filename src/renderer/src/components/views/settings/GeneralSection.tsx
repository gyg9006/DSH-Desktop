import { useEffect, useState } from 'react'
import type { JSX } from 'react'
import { Languages, Bot, HardDrive, FolderOpen, Loader2, CheckCircle2, XCircle } from 'lucide-react'
import type { DshUiSettingsResult, RelocateEventPayload } from '@shared/ipc'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../ui/card'
import { Button } from '../../ui/button'
import { Progress } from '../../ui/progress'
import { useToast } from '../../ui/toast'
import { cn } from '../../../lib/utils'

/** 通用设置：工作文件夹（迁移）+ 语言 + Agent 预设（同步 dsh settings.yaml 热重载）。 */
export function GeneralSection(): JSX.Element {
  const { toast } = useToast()
  const [settings, setSettings] = useState<DshUiSettingsResult | null>(null)
  const [workspacePath, setWorkspacePath] = useState('加载中…')
  const [relocating, setRelocating] = useState(false)
  const [relocateEvent, setRelocateEvent] = useState<RelocateEventPayload | null>(null)

  useEffect(() => {
    void window.dshw.getDshUiSettings().then(setSettings).catch(() => undefined)
    void window.dshw.getWorkspaceInfo().then((info) => setWorkspacePath(info.workspacePath)).catch(() => undefined)
    const unsubscribe = window.dshw.onRelocateEvent((event) => {
      setRelocateEvent(event)
      if (event.phase === 'done') {
        setRelocating(false)
        toast(event.message ?? '迁移完成，正在重启应用…', 'success')
        window.setTimeout(() => {
          void window.dshw.relaunchApp().catch(() => undefined)
        }, 1500)
      } else if (event.phase === 'error') {
        setRelocating(false)
        toast(event.message ?? '迁移失败', 'error')
      }
    })
    return unsubscribe
  }, [toast])

  const setLocale = async (locale: 'zh' | 'en'): Promise<void> => {
    await window.dshw.setDshUiSettings({ locale })
    setSettings((s) => (s ? { ...s, locale } : s))
  }

  const setPreset = async (id: string): Promise<void> => {
    await window.dshw.setDshUiSettings({ defaultAgentPreset: id })
    setSettings((s) => (s ? { ...s, defaultAgentPreset: id } : s))
  }

  const relocate = async (): Promise<void> => {
    const chosen = await window.dshw.chooseDirectory('选择新的工作文件夹位置')
    if (!chosen.ok || chosen.canceled || !chosen.path) return
    if (!confirm(`将工作文件夹迁移到：\n${chosen.path}\n\n将复制会话、知识库、技能、插件、配置、日志与缓存（运行时环境除外），校验通过后切换，旧目录保留为 *.old 可回滚。迁移期间请勿操作。`)) return
    setRelocating(true)
    setRelocateEvent(null)
    const result = await window.dshw.relocateWorkspace(chosen.path)
    if (!result.ok) {
      setRelocating(false)
      toast(result.error ?? '迁移失败', 'error')
    }
  }

  return (
    <div className="max-w-2xl space-y-4">
      {/* 工作文件夹 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <HardDrive className="h-4 w-4 text-cyber-neon" /> 工作文件夹
          </CardTitle>
          <CardDescription>会话记录、知识库、技能、插件、配置与凭据全部保存在工作文件夹内；可整文件夹迁移到其他位置或另一台电脑。</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="rounded-lg border border-cyber-border bg-cyber-panel2 px-3 py-2.5">
            <div className="mb-1 text-[10px] text-cyber-dim">当前路径</div>
            <div className="break-all font-mono text-xs text-cyber-text">{workspacePath}</div>
          </div>
          {relocating && (
            <div className="space-y-1.5 rounded-lg border border-cyber-neon/30 bg-cyber-neon/5 px-3 py-2">
              <div className="text-[11px] text-cyber-neon">{relocateEvent?.message ?? '准备迁移…'}</div>
              {relocateEvent?.total ? (
                <Progress value={Math.round(((relocateEvent.done ?? 0) / relocateEvent.total) * 100)} className="h-1.5" />
              ) : null}
              {relocateEvent?.phase === 'progress' && (
                <div className="text-right font-mono text-[10px] text-cyber-dim">
                  {relocateEvent.done}/{relocateEvent.total}
                </div>
              )}
            </div>
          )}
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={() => void relocate()} disabled={relocating || workspacePath === '加载中…'}>
              {relocating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FolderOpen className="h-3.5 w-3.5" />}
              更改位置并迁移…
            </Button>
            <Button size="sm" variant="ghost" onClick={() => void window.dshw.openWorkspaceFolder()} disabled={relocating}>
              在资源管理器中打开
            </Button>
            {relocateEvent?.phase === 'done' && <CheckCircle2 className="h-4 w-4 text-cyber-green" />}
            {relocateEvent?.phase === 'error' && <XCircle className="h-4 w-4 text-cyber-red" />}
          </div>
          <p className="text-[11px] leading-relaxed text-cyber-faint">
            迁移为原子操作：复制 → 完整性校验 → 切换配置 → 旧目录改名保留（*.old）；任一步失败自动回滚，原数据不受影响。运行时环境（runtime/）不随迁移，迁移后重新一键安装即可。
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Languages className="h-4 w-4 text-cyber-neon" /> 界面语言
          </CardTitle>
          <CardDescription>同步写入 dsh 的 settings.yaml，对话界面与桌面端共用。</CardDescription>
        </CardHeader>
        <CardContent className="flex gap-2">
          {(['zh', 'en'] as const).map((l) => (
            <Button
              key={l}
              size="sm"
              variant={settings?.locale === l ? 'default' : 'outline'}
              onClick={() => void setLocale(l)}
            >
              {l === 'zh' ? '简体中文' : 'English'}
            </Button>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bot className="h-4 w-4 text-cyber-neon" /> Agent 预设
          </CardTitle>
          <CardDescription>选择 dsh 对话默认使用的 Agent 预设（标准 / 极简 / PTC / 创造等）。</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {(settings?.presets ?? []).map((p) => (
            <button
              key={p.id}
              onClick={() => void setPreset(p.id)}
              className={cn(
                'rounded-lg border p-3 text-left transition-all',
                settings?.defaultAgentPreset === p.id
                  ? 'glow-border border-cyber-neon/60 bg-cyber-neon/10'
                  : 'border-cyber-border bg-cyber-panel hover:border-cyber-neon/40'
              )}
            >
              <div className="text-xs font-semibold text-cyber-text">{p.name}</div>
              {p.description && <div className="mt-0.5 text-[10px] leading-relaxed text-cyber-dim">{p.description}</div>}
            </button>
          ))}
        </CardContent>
      </Card>
    </div>
  )
}
