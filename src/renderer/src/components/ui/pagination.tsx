import { ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '../../lib/utils'

interface PaginationProps {
  total: number
  pageSize: number
  page: number
  onPage: (page: number) => void
}

/** 简约分页器（每页 pageSize 条，显示 1 2 3 … N）。 */
export function Pagination({ total, pageSize, page, onPage }: PaginationProps): React.JSX.Element | null {
  const pages = Math.max(1, Math.ceil(total / pageSize))
  if (pages <= 1) return null
  const current = Math.min(Math.max(1, page), pages)

  const items: number[] = []
  for (let i = 1; i <= pages; i++) {
    if (i === 1 || i === pages || Math.abs(i - current) <= 1) items.push(i)
  }

  return (
    <div className="mt-3 flex items-center justify-center gap-1">
      <button
        aria-label="上一页"
        disabled={current <= 1}
        onClick={() => onPage(current - 1)}
        className="flex h-7 w-7 items-center justify-center rounded-md border border-cyber-border text-cyber-dim transition-colors hover:border-cyber-neon/50 hover:text-cyber-neon disabled:opacity-40 disabled:hover:border-cyber-border disabled:hover:text-cyber-dim"
      >
        <ChevronLeft className="h-3.5 w-3.5" />
      </button>
      {items.map((n, i) => {
        const gap = i > 0 && items[i - 1] !== n - 1
        return (
          <span key={n} className="flex items-center gap-1">
            {gap && <span className="px-0.5 text-[11px] text-cyber-faint">…</span>}
            <button
              onClick={() => onPage(n)}
              className={cn(
                'h-7 min-w-7 rounded-md border px-1.5 text-[11px] transition-colors',
                n === current
                  ? 'border-cyber-neon/60 bg-cyber-neon/15 text-cyber-neon shadow-[0_0_8px_rgba(0,229,255,0.2)]'
                  : 'border-cyber-border text-cyber-dim hover:border-cyber-neon/40 hover:text-cyber-neon'
              )}
            >
              {n}
            </button>
          </span>
        )
      })}
      <button
        aria-label="下一页"
        disabled={current >= pages}
        onClick={() => onPage(current + 1)}
        className="flex h-7 w-7 items-center justify-center rounded-md border border-cyber-border text-cyber-dim transition-colors hover:border-cyber-neon/50 hover:text-cyber-neon disabled:opacity-40 disabled:hover:border-cyber-border disabled:hover:text-cyber-dim"
      >
        <ChevronRight className="h-3.5 w-3.5" />
      </button>
      <span className="ml-1 text-[10px] text-cyber-faint">共 {total} 项</span>
    </div>
  )
}
