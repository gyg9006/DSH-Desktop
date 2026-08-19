import { useEffect, useState } from 'react'

import type { JSX } from 'react'
import { Minus, Square, Copy, X } from 'lucide-react'
import { cn } from '../../lib/utils'
import { getAppVersion } from '../../lib/appInfo'

/**
 * v2.0 自定义无边框标题栏：标题 + 窗口控制按钮。
 * 拖拽区由 .titlebar-drag 提供（-webkit-app-region: drag）。
 */
export function TitleBar(): JSX.Element {
  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    void window.dshw.windowIsMaximized().then(setMaximized).catch(() => undefined)
  }, [])

  const onMaximize = async (): Promise<void> => {
    const next = await window.dshw.windowToggleMaximize()
    setMaximized(next)
  }

  return (
    <header
      className="titlebar-drag relative z-50 flex h-9 shrink-0 items-center border-b border-cyber-border bg-cyber-panel/80 backdrop-blur-glass"
    >
      {/* 左侧：Logo + 标题 */}
      <div className="flex items-center gap-2 pl-3">
        <span className="relative flex h-5 w-5 items-center justify-center rounded-md bg-gradient-to-br from-cyber-neon to-cyber-violet text-[10px] font-black text-cyber-bg shadow-glow-neon">
          D
        </span>
        <span className="text-xs font-semibold tracking-widest text-cyber-text">
          DSH-Desktop
        </span>
        <span className="ml-1 rounded border border-cyber-border px-1 py-px text-[9px] text-cyber-faint">
          v{getAppVersion()}
        </span>
      </div>

      <div className="flex-1" />

      {/* 窗口控制 */}
      <div className="titlebar-no-drag flex h-full items-stretch">
        <button
          aria-label="最小化"
          onClick={() => void window.dshw.windowMinimize()}
          className="flex w-11 items-center justify-center text-cyber-dim transition-colors hover:bg-white/10 hover:text-cyber-text"
        >
          <Minus className="h-3.5 w-3.5" />
        </button>
        <button
          aria-label={maximized ? '还原' : '最大化'}
          onClick={() => void onMaximize()}
          className="flex w-11 items-center justify-center text-cyber-dim transition-colors hover:bg-white/10 hover:text-cyber-text"
        >
          {maximized ? <Copy className="h-3.5 w-3.5" /> : <Square className="h-3 w-3" />}
        </button>
        <button
          aria-label="关闭"
          onClick={() => void window.dshw.windowClose()}
          className={cn(
            'flex w-11 items-center justify-center text-cyber-dim transition-colors hover:bg-cyber-red/90 hover:text-white'
          )}
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </header>
  )
}
