import { Play, Square, Loader2 } from 'lucide-react'

import type { JSX } from 'react'
import { useDshService } from '../../hooks/useDshService'
import { cn } from '../../lib/utils'
import { Button } from '../ui/button'

/**
 * v2.0 底部状态栏：
 * 区域7：端口 / 本地地址 / 运行状态指示灯；
 * 区域8：服务控制按钮（启动 / 停止，带加载动画）。
 */
export function Footer(): JSX.Element {
  const service = useDshService()
  const running = service.status === 'running'
  const starting = service.status === 'starting'
  const error = service.status === 'error'
  const busy = service.busy || starting
  const port = service.port ?? 3080

  const dotClass = cn(
    'status-dot',
    running && 'status-dot--running',
    error && 'status-dot--error',
    !running && !error && 'status-dot--stopped'
  )
  const statusText = error ? '服务异常' : running ? '运行中' : starting ? '启动中…' : '已停止'

  return (
    <footer className="flex h-10 shrink-0 items-center gap-4 border-t border-cyber-border bg-cyber-panel/80 px-4 backdrop-blur-glass">
      {/* 区域 7：状态 + 端口 + 地址 */}
      <div className="flex items-center gap-2">
        <span className={dotClass} />
        <span className={cn('text-xs font-medium', running ? 'text-cyber-green' : error ? 'text-cyber-red' : 'text-cyber-dim')}>
          {statusText}
        </span>
      </div>
      {port && (
        <div className="flex items-center gap-3 font-mono text-[11px] text-cyber-dim">
          <span>端口 <span className="text-cyber-text">{port}</span></span>
          <span className="text-cyber-faint">|</span>
          <span>
            本地地址{' '}
            <span className={cn(running && 'neon-text')}>http://localhost:{port}</span>
          </span>
        </div>
      )}

      <div className="flex-1" />

      {/* 区域 8：服务控制 */}
      {running ? (
        <Button size="sm" variant="danger" onClick={() => void service.stop()} disabled={busy}>
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Square className="h-3.5 w-3.5" />}
          停止服务
        </Button>
      ) : (
        <Button size="sm" variant="default" onClick={() => void service.start()} disabled={busy}>
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
          启动服务
        </Button>
      )}
    </footer>
  )
}
