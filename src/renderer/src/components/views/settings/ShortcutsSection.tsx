import type { JSX } from 'react'
import { Keyboard } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../ui/card'

const SHORTCUTS: Array<{ keys: string[]; action: string }> = [
  { keys: ['Ctrl', 'B'], action: '收起 / 展开侧边栏' },
  { keys: ['Ctrl', 'N'], action: '新建对话' },
  { keys: ['Ctrl', ','], action: '打开设置' }
]

/** 快捷键说明（快捷键本身由主进程全局注册）。 */
export function ShortcutsSection(): JSX.Element {
  return (
    <Card className="max-w-2xl">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Keyboard className="h-4 w-4 text-cyber-neon" /> 快捷键
        </CardTitle>
        <CardDescription>以下快捷键由应用全局注册，任意界面可用。</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {SHORTCUTS.map((s) => (
          <div key={s.action} className="flex items-center justify-between rounded-lg border border-cyber-border bg-cyber-panel2 px-3 py-2.5">
            <span className="text-sm text-cyber-text">{s.action}</span>
            <span className="flex gap-1.5">
              {s.keys.map((k) => (
                <kbd
                  key={k}
                  className="rounded-md border border-cyber-neon/40 bg-cyber-neon/10 px-2 py-0.5 font-mono text-[11px] text-cyber-neon"
                >
                  {k}
                </kbd>
              ))}
            </span>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}
