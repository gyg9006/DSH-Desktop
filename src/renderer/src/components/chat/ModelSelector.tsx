import { useCallback, useEffect, useState } from 'react'
import type { JSX } from 'react'
import { ChevronDown, Cloud, HardDrive } from 'lucide-react'
import type { ModelsViewPayload } from '@shared/ipc'
import { useToast } from '../ui/toast'
import { cn } from '../../lib/utils'

interface SelectableModel {
  id: string
  providerId: string
  providerName: string
  region: 'international' | 'china' | 'local'
  label: string
}

/**
 * 模型选择器（核心工作台工具栏）：
 * - 收集所有「已启用厂商」的可用模型，☁️ 云端 / 🖥️ 本地 分区；
 * - 显示当前默认对话模型（绿点状态）；
 * - 选择即时保存为默认对话模型（dsh 对话将使用该模型）。
 */
export function ModelSelector(): JSX.Element {
  const { toast } = useToast()
  const [view, setView] = useState<ModelsViewPayload | null>(null)
  const [open, setOpen] = useState(false)
  const [current, setCurrent] = useState<SelectableModel | null>(null)

  const build = useCallback((v: ModelsViewPayload): { list: SelectableModel[]; current: SelectableModel | null } => {
    const list: SelectableModel[] = []
    let current: SelectableModel | null = null
    for (const p of v.presets) {
      const cfg = v.providers[p.id]
      if (!cfg?.enabled) continue
      const models = cfg.models ?? []
      for (const m of models) {
        const item: SelectableModel = { id: `${p.id}/${m}`, providerId: p.id, providerName: p.name, region: p.region, label: m }
        list.push(item)
        if (cfg.defaultChat === m) current = item
      }
    }
    for (const c of v.custom) {
      if (!c.enabled) continue
      for (const m of c.models ?? []) {
        list.push({ id: `${c.id}/${m}`, providerId: c.id, providerName: c.name, region: 'local' as const, label: m })
      }
    }
    return { list, current }
  }, [])

  const refresh = useCallback(async (): Promise<void> => {
    const v = await window.dshw.modelsGet()
    setView(v)
    const built = build(v)
    let next = built.current
    if (!next && built.list.length) next = built.list[0]
    setCurrent(next)
  }, [build])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const select = async (m: SelectableModel): Promise<void> => {
    setCurrent(m)
    setOpen(false)
    await window.dshw.modelsProviderSet({ providerId: m.providerId, patch: { defaultChat: m.label } })
    toast(`默认对话模型：${m.providerName} / ${m.label}`, 'success')
  }

  if (!view) return <span className="h-7" />

  const { list } = view && current ? { list: build(view).list } : { list: [] }
  const cloud = list.filter((m) => m.region !== 'local')
  const local = list.filter((m) => m.region === 'local')

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex h-7 items-center gap-1.5 rounded-md border border-cyber-border bg-cyber-panel2 px-2 text-[11px] text-cyber-text transition-colors hover:border-cyber-neon/50"
      >
        {current?.region === 'local' ? (
          <HardDrive className="h-3 w-3 text-cyber-green" />
        ) : (
          <Cloud className="h-3 w-3 text-cyber-neon" />
        )}
        <span className="max-w-[140px] truncate font-mono">{current?.label ?? '选择模型'}</span>
        <ChevronDown className="h-3 w-3 text-cyber-dim" />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-8 z-50 max-h-80 w-72 overflow-y-auto rounded-lg border border-cyber-border bg-cyber-panel p-2 shadow-glass">
            {list.length === 0 && (
              <div className="p-4 text-center text-xs text-cyber-faint">
                暂无可用模型——请到「设置 → 模型与 API」启用厂商并勾选模型
              </div>
            )}
            {cloud.length > 0 && (
              <div className="mb-1 px-2 text-[10px] font-medium text-cyber-dim">☁️ 云端模型</div>
            )}
            {cloud.map((m) => (
              <button
                key={m.id}
                onClick={() => void select(m)}
                className={cn(
                  'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[11px] transition-colors',
                  current?.id === m.id ? 'bg-cyber-neon/10 text-cyber-neon' : 'text-cyber-text hover:bg-white/5'
                )}
              >
                <span className={cn('h-1.5 w-1.5 rounded-full', current?.id === m.id ? 'bg-cyber-green shadow-[0_0_4px_rgba(34,229,132,0.8)]' : 'bg-cyber-faint')} />
                <span className="truncate font-mono">{m.label}</span>
                <span className="ml-auto shrink-0 text-[9px] text-cyber-faint">{m.providerName}</span>
              </button>
            ))}
            {local.length > 0 && (
              <div className="mb-1 mt-2 px-2 text-[10px] font-medium text-cyber-dim">🖥️ 本地模型</div>
            )}
            {local.map((m) => (
              <button
                key={m.id}
                onClick={() => void select(m)}
                className={cn(
                  'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[11px] transition-colors',
                  current?.id === m.id ? 'bg-cyber-neon/10 text-cyber-neon' : 'text-cyber-text hover:bg-white/5'
                )}
              >
                <span className={cn('h-1.5 w-1.5 rounded-full', current?.id === m.id ? 'bg-cyber-green shadow-[0_0_4px_rgba(34,229,132,0.8)]' : 'bg-cyber-faint')} />
                <span className="truncate font-mono">{m.label}</span>
                <span className="ml-auto shrink-0 text-[9px] text-cyber-faint">{m.providerName}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
