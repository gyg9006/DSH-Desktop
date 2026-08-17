import * as React from 'react'
import { cn } from '../../lib/utils'

interface ProgressProps extends React.HTMLAttributes<HTMLDivElement> {
  value?: number
}

/** shadcn 风格进度条（0-100）。 */
const Progress = React.forwardRef<HTMLDivElement, ProgressProps>(({ className, value = 0, ...props }, ref) => (
  <div
    ref={ref}
    role="progressbar"
    aria-valuemin={0}
    aria-valuemax={100}
    aria-valuenow={Math.min(100, Math.max(0, value))}
    className={cn('relative h-2 w-full overflow-hidden rounded-full bg-cyber-panel2', className)}
    {...props}
  >
    <div
      className="h-full rounded-full bg-gradient-to-r from-cyber-neon to-cyber-violet shadow-[0_0_8px_rgba(0,229,255,0.5)] transition-all duration-300"
      style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
    />
  </div>
))
Progress.displayName = 'Progress'

export { Progress }
