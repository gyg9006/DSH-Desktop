import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { Slot } from '@radix-ui/react-slot'
import { cn } from '../../lib/utils'

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyber-neon/50 disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        default:
          'bg-cyber-neon text-cyber-bg hover:bg-cyber-neon/85 shadow-[0_0_12px_rgba(0,229,255,0.35)]',
        violet:
          'bg-cyber-violet text-white hover:bg-cyber-violet/85 shadow-[0_0_12px_rgba(139,92,246,0.35)]',
        outline:
          'border border-cyber-border bg-transparent text-cyber-text hover:border-cyber-neon/50 hover:text-cyber-neon',
        ghost: 'text-cyber-dim hover:bg-white/5 hover:text-cyber-text',
        danger:
          'bg-cyber-red/15 text-cyber-red border border-cyber-red/40 hover:bg-cyber-red/25',
        success:
          'bg-cyber-green/15 text-cyber-green border border-cyber-green/40 hover:bg-cyber-green/25'
      },
      size: {
        default: 'h-9 px-4 py-2',
        sm: 'h-7 rounded-md px-3 text-xs',
        lg: 'h-11 rounded-lg px-6 text-base',
        icon: 'h-9 w-9'
      }
    },
    defaultVariants: {
      variant: 'default',
      size: 'default'
    }
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button'
    return <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
  }
)
Button.displayName = 'Button'

export { Button, buttonVariants }
