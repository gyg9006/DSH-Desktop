import * as React from 'react'
import { createContext, useCallback, useContext, useRef, useState } from 'react'
import type { JSX } from 'react'
import { CheckCircle2, XCircle, Info } from 'lucide-react'
import { cn } from '../../lib/utils'

type ToastVariant = 'success' | 'error' | 'info'

interface ToastItem {
  id: number
  message: string
  variant: ToastVariant
}

interface ToastContextValue {
  toast: (message: string, variant?: ToastVariant) => void
}

const ToastContext = createContext<ToastContextValue>({ toast: () => undefined })

export function useToast(): ToastContextValue {
  return useContext(ToastContext)
}

/** 轻量 Toast（shadcn 风格）：成功 ✅ / 错误 ❌ / 信息 ℹ️，3 秒自动消失。 */
export function ToastProvider({ children }: { children: React.ReactNode }): JSX.Element {
  const [items, setItems] = useState<ToastItem[]>([])
  const counter = useRef(0)

  const remove = useCallback((id: number): void => {
    setItems((prev) => prev.filter((t) => t.id !== id))
  }, [])

  const toast = useCallback(
    (message: string, variant: ToastVariant = 'info'): void => {
      const id = ++counter.current
      setItems((prev) => [...prev.slice(-3), { id, message, variant }])
      window.setTimeout(() => remove(id), 3000)
    },
    [remove]
  )

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      {/* Toast 容器（fixed 右下） */}
      <div className="pointer-events-none fixed bottom-14 right-4 z-[100] flex w-80 flex-col gap-2">
        {items.map((t) => (
          <div
            key={t.id}
            className={cn(
              'pointer-events-auto flex items-start gap-2 rounded-lg border px-3 py-2.5 text-xs shadow-glass backdrop-blur-glass animate-fade-in',
              t.variant === 'success' && 'border-cyber-green/40 bg-cyber-green/10 text-cyber-green',
              t.variant === 'error' && 'border-cyber-red/40 bg-cyber-red/10 text-cyber-red',
              t.variant === 'info' && 'border-cyber-neon/40 bg-cyber-neon/10 text-cyber-neon'
            )}
          >
            {t.variant === 'success' && <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
            {t.variant === 'error' && <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
            {t.variant === 'info' && <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
            <span className="leading-relaxed">{t.message}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}
