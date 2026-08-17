import { useEffect, useState } from 'react'
import type { JSX } from 'react'
import { Moon, Sun, Monitor, Palette } from 'lucide-react'
import type { ActiveThemePayload, ThemeInfoPayload, ThemeMode } from '@shared/ipc'
import { useTheme } from '../../../hooks/useTheme'
import { applyClientTheme } from '../../../lib/theme'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../ui/card'
import { Button } from '../../ui/button'
import { Badge } from '../../ui/badge'
import { cn } from '../../../lib/utils'

const THEMES: Array<{ key: ThemeMode; name: string; icon: typeof Moon; desc: string }> = [
  { key: 'dark', name: '深色', icon: Moon, desc: '暗色基调' },
  { key: 'light', name: '浅色', icon: Sun, desc: '明亮模式' },
  { key: 'system', name: '跟随系统', icon: Monitor, desc: '随 Windows 自动切换' }
]

/** 外观设置：客户端主题（全局 Design Token 换肤）+ dsh 明暗偏好。 */
export function AppearanceSection(): JSX.Element {
  const { theme, setTheme } = useTheme()
  const [themeList, setThemeList] = useState<ThemeInfoPayload[]>([])
  const [activeTheme, setActiveTheme] = useState<ActiveThemePayload | null>(null)

  useEffect(() => {
    void window.dshw.themeList().then(setThemeList).catch(() => undefined)
    void window.dshw.themeGet().then(setActiveTheme).catch(() => undefined)
  }, [])

  const switchTheme = async (id: string): Promise<void> => {
    const r = await window.dshw.themeSet(id)
    if (r.ok && r.theme) {
      setActiveTheme(r.theme)
      applyClientTheme(r.theme)
    }
  }

  return (
    <div className="max-w-3xl space-y-4">
      {/* 客户端主题（全局换肤） */}
      <Card className="glow-border border-cyber-neon/30">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Palette className="h-4 w-4 text-cyber-neon" /> 客户端主题
          </CardTitle>
          <CardDescription>
            主题插件（type=theme, scope=application）作用于整个客户端：标题栏、侧边栏、工作台、弹窗、设置页、托盘图标等全部 UI。
            将主题插件放入工作文件夹 themes/ 目录后，重启即可在此选择。
          </CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {themeList.map((t) => (
            <button
              key={t.id}
              onClick={() => void switchTheme(t.id)}
              className={cn(
                'flex flex-col items-start gap-1.5 rounded-xl border p-3 text-left transition-all',
                activeTheme?.id === t.id ? 'glow-border border-cyber-neon/60 bg-cyber-neon/10' : 'border-cyber-border bg-cyber-panel hover:border-cyber-neon/40'
              )}
            >
              <span className="flex w-full items-center justify-between">
                <span className="text-sm font-medium text-cyber-text">{t.name}</span>
                {t.isDefault && <Badge variant="outline" className="px-1.5 text-[9px]">内置</Badge>}
                {!t.isDefault && t.hasPreview && <Badge variant="violet" className="px-1.5 text-[9px]">有预览</Badge>}
              </span>
              <span className="text-[10px] text-cyber-dim">
                v{t.version}
                {t.author ? ` · ${t.author}` : ''}
                {t.darkMode ? ' · 暗色' : ' · 亮色'}
              </span>
            </button>
          ))}
        </CardContent>
      </Card>

      {/* dsh 明暗偏好 */}
      <Card>
        <CardHeader>
          <CardTitle>明暗偏好</CardTitle>
          <CardDescription>深色 / 浅色 / 跟随系统，与 dsh 界面同步。</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-3 gap-3">
          {THEMES.map((t) => {
            const Icon = t.icon
            const active = theme === t.key
            return (
              <button
                key={t.key}
                onClick={() => void setTheme(t.key)}
                className={cn(
                  'flex flex-col items-center gap-2 rounded-xl border p-4 transition-all',
                  active ? 'glow-border border-cyber-neon/60 bg-cyber-neon/10' : 'border-cyber-border bg-cyber-panel hover:border-cyber-neon/40'
                )}
              >
                <Icon className={cn('h-6 w-6', active ? 'text-cyber-neon' : 'text-cyber-dim')} />
                <span className="text-sm font-medium text-cyber-text">{t.name}</span>
                <span className="text-center text-[10px] leading-relaxed text-cyber-dim">{t.desc}</span>
              </button>
            )
          })}
        </CardContent>
        <CardContent className="pt-0">
          <Button size="sm" variant="outline" onClick={() => void window.dshw.openSettingsFile()}>
            打开 dsh 设置文件
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
