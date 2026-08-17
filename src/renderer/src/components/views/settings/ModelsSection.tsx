import { useCallback, useEffect, useState } from 'react'
import type { JSX } from 'react'
import {
  Cloud, HardDrive, Plus, Trash2, Eye, EyeOff, Plug, RefreshCw, Loader2,
  CheckCircle2, XCircle, Star, Pencil
} from 'lucide-react'
import type { ModelsViewPayload, ModelProviderConfig, ProviderProtocol } from '@shared/ipc'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../ui/card'
import { Button } from '../../ui/button'
import { Badge } from '../../ui/badge'
import { Input } from '../../ui/input'
import { Switch } from '../../ui/switch'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '../../ui/dialog'
import { useToast } from '../../ui/toast'
import { cn } from '../../../lib/utils'

interface ProviderListItem {
  id: string
  name: string
  region: string
  protocol: ProviderProtocol
  baseUrl: string
  models: string[]
  keyMask: string
  config: ModelProviderConfig
}

/**
 * 模型与 API —— 全域模型对接中心（两栏：厂商卡片列表 + 右侧详情配置）。
 * 预设 13 家 + 自定义 OpenAI 兼容端点 + Ollama 本地；Key 加密存储、连接测试、模型列表、默认模型三类。
 */
export function ModelsSection(): JSX.Element {
  const [view, setView] = useState<ModelsViewPayload | null>(null)
  const [selectedId, setSelectedId] = useState<string>('')
  const [customOpen, setCustomOpen] = useState(false)

  const refresh = useCallback(async (): Promise<void> => {
    const v = await window.dshw.modelsGet()
    setView(v)
    if (!selectedId && v.presets.length) setSelectedId(v.presets[0].id)
  }, [selectedId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  if (!view) return <div className="flex h-full items-center justify-center text-cyber-dim">加载中…</div>

  const items: ProviderListItem[] = [
    ...view.presets.map((p) => ({
      id: p.id,
      name: p.name,
      region: p.region,
      protocol: p.protocol,
      baseUrl: p.baseUrl,
      models: p.defaultModels,
      keyMask: view.keyMasks[p.id] ?? '',
      config: view.providers[p.id] ?? { enabled: false, models: [] }
    })),
    ...view.custom.map((c) => ({
      id: c.id,
      name: c.name,
      region: 'custom' as const,
      protocol: c.protocol,
      baseUrl: c.baseUrl,
      models: c.models,
      keyMask: view.keyMasks[c.id] ?? '',
      config: { enabled: c.enabled, models: c.models } as ModelProviderConfig
    }))
  ]
  const selected = items.find((i) => i.id === selectedId) ?? items[0]

  return (
    <div className="flex h-full gap-4 overflow-hidden">
      {/* 左：厂商卡片列表 */}
      <div className="w-72 shrink-0 space-y-2 overflow-y-auto pr-1">
        <div className="mb-1 flex items-center justify-between">
          <span className="text-[11px] font-medium text-cyber-dim">厂商列表</span>
          <Button size="sm" variant="outline" className="h-6 px-2 text-[11px]" onClick={() => setCustomOpen(true)}>
            <Plus className="h-3 w-3" /> 自定义厂商
          </Button>
        </div>
        {items.map((item) => (
          <button
            key={item.id}
            onClick={() => setSelectedId(item.id)}
            className={cn(
              'flex w-full items-center gap-2 rounded-lg border p-2.5 text-left transition-all',
              selectedId === item.id ? 'glow-border border-cyber-neon/60 bg-cyber-neon/10' : 'border-cyber-border bg-cyber-panel hover:border-cyber-neon/40'
            )}
          >
            {item.region === 'local' ? (
              <HardDrive className="h-4 w-4 shrink-0 text-cyber-green" />
            ) : (
              <Cloud className={cn('h-4 w-4 shrink-0', item.region === 'china' ? 'text-cyber-amber' : 'text-cyber-neon')} />
            )}
            <span className="min-w-0 flex-1">
              <span className="block truncate text-xs font-medium text-cyber-text">{item.name}</span>
              <span className="block truncate font-mono text-[10px] text-cyber-faint">{item.baseUrl}</span>
            </span>
            <span className="flex shrink-0 flex-col items-end gap-1">
              {item.config.enabled && <Badge variant="green" className="px-1.5 text-[9px]">启用</Badge>}
              {item.keyMask && <span className="font-mono text-[9px] text-cyber-dim">{item.keyMask}</span>}
            </span>
          </button>
        ))}
        <p className="pt-1 text-[10px] leading-relaxed text-cyber-faint">
          预设厂商（联网核实 OpenAI 兼容端点）：OpenAI / Anthropic / Gemini / Grok / Mistral / DeepSeek / 千问 / 智谱 / Kimi / 文心 / 混元 / 星火 / MiniMax + Ollama 本地。
        </p>
      </div>

      {/* 右：详情配置 */}
      {selected && (
        <ProviderDetail
          key={selected.id}
          item={selected}
          onChanged={() => void refresh()}
        />
      )}

      {/* 自定义厂商对话框 */}
      <CustomProviderDialog open={customOpen} onOpenChange={setCustomOpen} onSaved={() => { setCustomOpen(false); void refresh() }} />
    </div>
  )
}

// ---------------- 厂商详情 ----------------
function ProviderDetail({ item, onChanged }: { item: ProviderListItem; onChanged: () => void }): JSX.Element {
  const { toast } = useToast()
  const [keyInput, setKeyInput] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; latencyMs?: number; error?: string } | null>(null)
  const [fetching, setFetching] = useState(false)
  const [remoteModels, setRemoteModels] = useState<string[] | null>(null)
  const [modelFilter, setModelFilter] = useState('')

  const enabled = item.config.enabled
  const models = item.config.models?.length ? item.config.models : item.models

  const saveEnabled = async (v: boolean): Promise<void> => {
    await window.dshw.modelsProviderSet({ providerId: item.id, patch: { enabled: v } })
    onChanged()
  }

  const saveKey = async (): Promise<void> => {
    if (!keyInput.trim()) return
    const r = await window.dshw.modelsKeySave(item.id, keyInput)
    if (r.ok) {
      setKeyInput('')
      toast('API Key 已加密保存', 'success')
      onChanged()
    } else {
      toast(r.error ?? '保存失败', 'error')
    }
  }

  const deleteKey = async (): Promise<void> => {
    if (!confirm('删除已保存的 API Key？')) return
    await window.dshw.modelsKeyDelete(item.id)
    onChanged()
  }

  const test = async (): Promise<void> => {
    setTesting(true)
    try {
      const r = await window.dshw.modelsTest({
        providerId: item.id,
        protocol: item.protocol,
        baseUrl: item.baseUrl,
        model: item.config.defaultChat ?? models[0]
      })
      setTestResult(r)
    } finally {
      setTesting(false)
    }
  }

  const fetchModels = async (): Promise<void> => {
    setFetching(true)
    try {
      const r = await window.dshw.modelsList({ providerId: item.id, protocol: item.protocol, baseUrl: item.baseUrl })
      if (r.ok && r.models && r.models.length) {
        setRemoteModels(r.models)
        await window.dshw.modelsProviderSet({ providerId: item.id, patch: { models: r.models.slice(0, 30) } })
        onChanged()
      } else {
        toast(r.error ?? '未获取到模型列表（将使用预设模型）', 'info')
      }
    } finally {
      setFetching(false)
    }
  }

  const toggleModel = async (m: string): Promise<void> => {
    const next = item.config.models.includes(m)
      ? item.config.models.filter((x) => x !== m)
      : [...item.config.models, m]
    await window.dshw.modelsProviderSet({ providerId: item.id, patch: { models: next } })
    onChanged()
  }

  const setDefault = async (kind: 'defaultChat' | 'defaultExtract' | 'defaultEmbedding', m: string): Promise<void> => {
    await window.dshw.modelsProviderSet({ providerId: item.id, patch: { [kind]: m } })
    onChanged()
  }

  const filteredModels = (remoteModels ?? models).filter((m) => m.toLowerCase().includes(modelFilter.toLowerCase()))

  return (
    <div className="min-w-0 flex-1 space-y-4 overflow-y-auto pr-1">
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <CardTitle className="flex-1 text-base">{item.name}</CardTitle>
            {item.region === 'local' ? <Badge variant="green">本地</Badge> : <Badge variant={item.region === 'china' ? 'amber' : 'default'}>{item.region === 'china' ? '国内' : '国际'}</Badge>}
            <Switch checked={enabled} onCheckedChange={(v) => void saveEnabled(v)} />
          </div>
          <CardDescription className="break-all font-mono text-[11px]">{item.baseUrl}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* API Key（加密存储，掩码显示） */}
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Input
                  type={showKey ? 'text' : 'password'}
                  placeholder={item.keyMask ? `已保存（${item.keyMask}），输入新 Key 可更换` : 'API Key（safeStorage 加密保存）'}
                  value={keyInput}
                  onChange={(e) => setKeyInput(e.target.value)}
                  className="h-8 pr-8 font-mono text-xs"
                />
                <button
                  aria-label="切换明文"
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-cyber-dim hover:text-cyber-neon"
                  onClick={() => setShowKey(!showKey)}
                >
                  {showKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                </button>
              </div>
              <Button size="sm" variant="default" className="h-8" onClick={() => void saveKey()} disabled={!keyInput.trim()}>
                保存 Key
              </Button>
              {item.keyMask && (
                <Button size="sm" variant="ghost" className="h-8 text-[11px] text-cyber-red" onClick={() => void deleteKey()}>
                  <Trash2 className="h-3 w-3" /> 删除
                </Button>
              )}
            </div>
            <p className="text-[10px] text-cyber-faint">Key 经 Electron safeStorage 加密落盘，界面仅显示掩码，明文永不持久化。</p>
          </div>

          {/* 连接测试 */}
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" className="h-8" onClick={() => void test()} disabled={testing}>
              {testing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plug className="h-3.5 w-3.5" />} 测试连接
            </Button>
            <Button size="sm" variant="ghost" className="h-8" onClick={() => void fetchModels()} disabled={fetching || item.protocol === 'anthropic'}>
              {fetching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} 拉取模型列表
            </Button>
            {testResult && (
              <span className={cn('flex items-center gap-1 text-xs', testResult.ok ? 'text-cyber-green' : 'text-cyber-red')}>
                {testResult.ok ? <CheckCircle2 className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}
                {testResult.ok ? `连接成功（${testResult.latencyMs ?? '?'} ms）` : `连接失败：${testResult.error}`}
              </span>
            )}
          </div>
        </CardContent>
      </Card>

      {/* 模型管理 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">模型</CardTitle>
          <CardDescription>勾选启用可用模型，设置三类默认模型（对话 / 提炼 / Embedding）。</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Input
            placeholder="搜索模型…"
            value={modelFilter}
            onChange={(e) => setModelFilter(e.target.value)}
            className="h-7 text-xs"
          />
          <div className="max-h-56 space-y-1 overflow-y-auto">
            {filteredModels.map((m) => {
              const on = item.config.models.includes(m)
              return (
                <div key={m} className="flex items-center gap-2 rounded-lg border border-cyber-border bg-cyber-panel2 px-2.5 py-1.5">
                  <Switch checked={on} onCheckedChange={() => void toggleModel(m)} className="scale-90" />
                  <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-cyber-text">{m}</span>
                  {item.config.defaultChat === m && <Badge variant="default" className="px-1.5 text-[9px]">对话</Badge>}
                  {item.config.defaultExtract === m && <Badge variant="violet" className="px-1.5 text-[9px]">提炼</Badge>}
                  {item.config.defaultEmbedding === m && <Badge variant="green" className="px-1.5 text-[9px]">Embedding</Badge>}
                </div>
              )
            })}
            {filteredModels.length === 0 && <div className="py-4 text-center text-xs text-cyber-faint">无模型（可「拉取模型列表」）</div>}
          </div>
          <div className="grid grid-cols-3 gap-2 text-[11px]">
            {(
              [
                ['defaultChat', '默认对话模型', 'default'],
                ['defaultExtract', '默认提炼模型', 'violet'],
                ['defaultEmbedding', '默认 Embedding', 'green']
              ] as const
            ).map(([kind, label]) => (
              <div key={kind} className="rounded-lg border border-cyber-border bg-cyber-panel2 p-2">
                <div className="mb-1 flex items-center gap-1 text-cyber-dim">
                  <Star className="h-3 w-3" /> {label}
                </div>
                <select
                  value={item.config[kind] ?? ''}
                  onChange={(e) => void setDefault(kind, e.target.value)}
                  className="h-7 w-full rounded-md border border-cyber-border bg-cyber-panel2 px-1.5 font-mono text-[10px] text-cyber-text focus:outline-none"
                >
                  <option value="">未设置</option>
                  {item.config.models.map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

// ---------------- 自定义厂商 ----------------
function CustomProviderDialog({
  open,
  onOpenChange,
  onSaved
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  onSaved: () => void
}): JSX.Element {
  const [name, setName] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [modelsText, setModelsText] = useState('')
  const [busy, setBusy] = useState(false)

  const save = async (): Promise<void> => {
    if (!name.trim() || !baseUrl.trim()) return
    setBusy(true)
    try {
      const id = name.trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-')
      const models = modelsText.split(/[\n,]/).map((s) => s.trim()).filter(Boolean)
      const r = await window.dshw.modelsCustomUpsert({ id, name: name.trim(), baseUrl: baseUrl.trim(), protocol: 'openai', models, enabled: true })
      if (r.ok) onSaved()
      else alert(r.error ?? '保存失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Pencil className="h-4 w-4 text-cyber-neon" /> 添加自定义厂商
          </DialogTitle>
          <DialogDescription>任意 OpenAI 兼容端点（OpenRouter / SiliconFlow / One API / LM Studio / vLLM…）。</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Input placeholder="厂商名称（如：OpenRouter）" value={name} onChange={(e) => setName(e.target.value)} />
          <Input placeholder="Base URL（如：https://openrouter.ai/api/v1）" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} className="font-mono text-xs" />
          <Input placeholder="模型名（逗号或换行分隔，可留空后拉取）" value={modelsText} onChange={(e) => setModelsText(e.target.value)} className="font-mono text-xs" />
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => onOpenChange(false)}>取消</Button>
            <Button size="sm" variant="default" onClick={() => void save()} disabled={busy || !name.trim() || !baseUrl.trim()}>
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />} 添加
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
