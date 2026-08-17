import { useCallback, useEffect, useRef, useState } from 'react'

import type { JSX } from 'react'
import { RefreshCw, FolderOpen, FileUp, BrainCircuit, Loader2 } from 'lucide-react'
import { useDshService } from '../../hooks/useDshService'
import { Button } from '../ui/button'
import { Badge } from '../ui/badge'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../ui/dialog'
import { Input } from '../ui/input'
import { Textarea } from '../ui/textarea'
import type { KnowledgeCategory, KnowledgeExtractResult } from '@shared/ipc'

/**
 * 模块1：DSH 核心工作台。
 * - 嵌入完整 DSH Web 界面（webview），保留全部功能；
 * - 会话导入（文件夹 / 文件）与知识提炼（SkillAdapter → 知识库）。
 */
export function DSHCore(): JSX.Element {
  const service = useDshService()
  const webviewRef = useRef<Electron.WebviewTag | null>(null)
  const [dshUrl, setDshUrl] = useState('')
  const running = service.status === 'running'

  useEffect(() => {
    if (running && service.port) {
      setDshUrl(`http://localhost:${service.port}/`)
    } else {
      setDshUrl('')
    }
  }, [running, service.port])

  const onImport = useCallback(async (mode: 'folder' | 'file'): Promise<void> => {
    const result = await window.dshw.importSessions(mode)
    if (result.ok && result.count > 0) {
      alert(`成功导入 ${result.count} 个会话`)
    } else if (!result.canceled) {
      alert(result.error ?? '没有导入任何会话')
    }
  }, [])

  return (
    <div className="flex h-full flex-col">
      {/* 工具栏 */}
      <div className="flex items-center gap-2 border-b border-cyber-border px-3 py-2">
        <span className="text-sm font-semibold text-cyber-text">核心工作台</span>
        {running && dshUrl && (
          <Badge variant="green" className="ml-1">
            dsh 已连接
          </Badge>
        )}
        <div className="flex-1" />
        <Button size="sm" variant="ghost" onClick={() => void onImport('folder')} disabled={!running}>
          <FolderOpen className="h-3.5 w-3.5" /> 导入文件夹
        </Button>
        <Button size="sm" variant="ghost" onClick={() => void onImport('file')} disabled={!running}>
          <FileUp className="h-3.5 w-3.5" /> 导入文件
        </Button>
        <Button size="sm" variant="outline" onClick={() => webviewRef.current?.reload()} disabled={!running}>
          <RefreshCw className="h-3.5 w-3.5" /> 刷新
        </Button>
        <KnowledgeExtractDialog />
      </div>

      {/* webview / 空态 */}
      <div className="min-h-0 flex-1">
        {running && dshUrl ? (
          <webview
            ref={(el) => {
              webviewRef.current = (el as Electron.WebviewTag | null) ?? null
            }}
            src={dshUrl}
            className="h-full w-full"
            style={{ display: 'flex' }}
            partition="persist:dshv2"
          />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-3">
            <div className="text-3xl">🛰️</div>
            <div className="text-sm text-cyber-text">服务未启动</div>
            <p className="max-w-sm text-center text-xs leading-relaxed text-cyber-dim">
              dsh 服务停止时无法加载对话界面。点击底部状态栏「启动服务」，启动后自动加载 DSH Web 工作台。
            </p>
            <Button
              size="sm"
              variant="default"
              disabled={service.busy}
              onClick={() => void service.start()}
            >
              {service.busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              启动服务
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}

/** 知识提炼对话框：输入会话文本 → 启发式提炼 → 入库（可选分类）。 */
function KnowledgeExtractDialog(): JSX.Element {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [categories, setCategories] = useState<KnowledgeCategory[]>([])
  const [categoryId, setCategoryId] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<KnowledgeExtractResult | null>(null)
  const [needCategory, setNeedCategory] = useState(false)
  const [newCategory, setNewCategory] = useState('')

  useEffect(() => {
    if (open) void window.dshw.knowledgeGet().then((p) => setCategories(p.categories))
  }, [open])

  const onExtract = async (): Promise<void> => {
    setBusy(true)
    setResult(null)
    try {
      if (needCategory) {
        const cat = await window.dshw.knowledgeCategoryCreate(newCategory)
        if (cat.ok && cat.category) {
          setCategoryId(cat.category.id)
          setNeedCategory(false)
          setNewCategory('')
          await window.dshw.knowledgeGet().then((p) => setCategories(p.categories))
        }
      }
      const res = await window.dshw.knowledgeExtract({
        sessionText: text,
        categoryId: categoryId || undefined
      })
      setResult(res)
      if (res.needCategory) setNeedCategory(true)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button size="sm" variant="violet" onClick={() => setOpen(true)}>
        <BrainCircuit className="h-3.5 w-3.5" /> 提炼为知识
      </Button>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>提炼为知识</DialogTitle>
          <DialogDescription>
            将当前会话内容提炼为结构化知识条目，存入知识库（启发式提取，生产环境可接入 knowledge-extraction 技能）。
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Textarea
            placeholder="粘贴会话内容 / 项目经验 / 解决方案…"
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="min-h-[160px] font-mono text-xs"
          />
          <div className="flex items-center gap-2">
            <span className="text-xs text-cyber-dim">存入分类：</span>
            <select
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
              className="h-8 flex-1 rounded-lg border border-cyber-border bg-cyber-panel2 px-2 text-xs text-cyber-text focus:border-cyber-neon/60 focus:outline-none"
            >
              <option value="">请选择分类…</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          {needCategory && (
            <div className="flex items-center gap-2 rounded-lg border border-cyber-amber/40 bg-cyber-amber/10 px-3 py-2">
              <span className="text-xs text-cyber-amber">没有可用分类，请新建：</span>
              <Input
                value={newCategory}
                onChange={(e) => setNewCategory(e.target.value)}
                placeholder="新分类名称"
                className="h-7 flex-1 text-xs"
              />
            </div>
          )}
          {result?.ok && (
            <div className="rounded-lg border border-cyber-green/40 bg-cyber-green/10 p-3 text-xs text-cyber-green">
              提炼成功：{(result.entries ?? []).map((e) => e.title).join('、') || '（空结果）'}
            </div>
          )}
          {result?.error && !result.needCategory && (
            <div className="rounded-lg border border-cyber-red/40 bg-cyber-red/10 p-3 text-xs text-cyber-red">
              {result.error}
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
              关闭
            </Button>
            <Button size="sm" variant="violet" onClick={() => void onExtract()} disabled={busy || !text.trim()}>
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <BrainCircuit className="h-3.5 w-3.5" />}
              开始提炼
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
