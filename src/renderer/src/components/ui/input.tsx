import * as React from 'react'
import { cn } from '../../lib/utils'

const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type, ...props }, ref) => (
    <input
      type={type}
      ref={ref}
      className={cn(
        'flex h-9 w-full rounded-lg border border-cyber-border bg-cyber-panel2 px-3 py-1 text-sm text-cyber-text transition-colors placeholder:text-cyber-faint focus-visible:border-cyber-neon/60 focus-visible:outline-none focus-visible:shadow-[0_0_10px_rgba(0,229,255,0.15)] disabled:cursor-not-allowed disabled:opacity-50',
        className
      )}
      {...props}
    />
  )
)
Input.displayName = 'Input'

export { Input }
