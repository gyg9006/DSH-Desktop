import type { JSX } from 'react'
import { Moon, Sun, Monitor } from 'lucide-react'
import type { ThemeMode } from '@shared/ipc'
import { useTheme } from '../../../hooks/useTheme'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../ui/card'
import { Button } from '../../ui/button'
import { cn } from '../../../lib/utils'

const THEMES: Array<{ key: ThemeMode; name: string; icon: typeof Moon; desc: string }> = [
  { key: 'dark', name: '深色', icon: Moon, desc: '赛博朋克深色（默认）' },
  { key: 'light', name: '浅色', icon: Sun, desc: '明亮模式' },
  { key: 'system', name: '跟随系统', icon: Monitor, desc: '随 Windows 深浅色自动切换' }
]

/** 外观设置：主题切换（同步 dsh settings.yaml + Tailwind dark class）。 */
export function AppearanceSection(): JSX.Element {
  const { theme, setTheme } = useTheme()

  return (
    <Card className="max-w-2xl">
      <CardHeader>
        <CardTitle>主题外观</CardTitle>
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
  )
}
