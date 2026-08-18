import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '../../lib/utils'

const badgeVariants = cva(
  'inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-medium transition-colors',
  {
    variants: {
      variant: {
        default: 'border-cyber-neon/40 bg-cyber-neon/10 text-cyber-neon',
        violet: 'border-cyber-violet/40 bg-cyber-violet/10 text-cyber-violet',
        green: 'border-cyber-green/40 bg-cyber-green/10 text-cyber-green',
        red: 'border-cyber-red/40 bg-cyber-red/10 text-cyber-red',
        amber: 'border-cyber-amber/40 bg-cyber-amber/10 text-cyber-amber',
        outline: 'border-cyber-border text-cyber-dim',
        hot: 'border-cyber-amber/50 bg-gradient-to-r from-cyber-amber/20 to-cyber-red/20 text-cyber-amber'
      }
    },
    defaultVariants: {
      variant: 'default'
    }
  }
)

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps): React.JSX.Element {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />
}

export { Badge, badgeVariants }
