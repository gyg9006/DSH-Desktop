import { useEffect, useState } from 'react'
import type { JSX } from 'react'
import { Languages, Bot } from 'lucide-react'
import type { DshUiSettingsResult } from '@shared/ipc'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../ui/card'
import { Button } from '../../ui/button'
import { cn } from '../../../lib/utils'

/** 通用设置：语言 + Agent 预设（同步 dsh settings.yaml 热重载）。 */
export function GeneralSection(): JSX.Element {
  const [settings, setSettings] = useState<DshUiSettingsResult | null>(null)

  useEffect(() => {
    void window.dshw.getDshUiSettings().then(setSettings).catch(() => undefined)
  }, [])

  const setLocale = async (locale: 'zh' | 'en'): Promise<void> => {
    await window.dshw.setDshUiSettings({ locale })
    setSettings((s) => (s ? { ...s, locale } : s))
  }

  const setPreset = async (id: string): Promise<void> => {
    await window.dshw.setDshUiSettings({ defaultAgentPreset: id })
    setSettings((s) => (s ? { ...s, defaultAgentPreset: id } : s))
  }

  return (
    <div className="max-w-2xl space-y-4">
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
