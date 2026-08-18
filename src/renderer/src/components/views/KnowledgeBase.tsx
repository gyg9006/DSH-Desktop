import { useCallback, useEffect, useMemo, useState } from 'react'

import type { JSX } from 'react'
import { Plus, Search, Trash2, Pencil, RefreshCw, Loader2, Database, BookOpen } from 'lucide-react'
import type { KnowledgeCategory, KnowledgeEntry } from '@shared/ipc'
import { Button } from '../ui/button'
import { Badge } from '../ui/badge'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../ui/dialog'
import { Input } from '../ui/input'
import { Textarea } from '../ui/textarea'
import { cn } from '../../lib/utils'

/**
 * 模块4：知识库管理 —— 科技感分类网格。
 * 分类 CRUD + 知识条目（时间戳 / 关键词标签）+ 搜索（关键词 / 时间范围）+ 提炼 + 自动迭代。
 */
export function KnowledgeBase(): JSX.Element {
  const [categories, setCategories] = useState<KnowledgeCategory[]>([])
  const [catDialog, setCatDialog] = useState<{ mode: 'create' | 'rename'; id?: string; name: string } | null>(null)
  const [entries, setEntries] = useState<KnowledgeEntry[]>([])
  const [activeCategory, setActiveCategory] = useState<string | null>(null)
  const [keyword, setKeyword] = useState('')
  const [busy, setBusy] = useState(false)
  const [iterateMsg, setIterateMsg] = useState('')

  const refresh = useCallback(async (): Promise<void> => {
    const payload = await window.dshw.knowledgeGet()
    setCategories(payload.categories)
    setEntries(payload.entries)
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  // 搜索：关键词 + 分类（时间范围后续接入日期选择）
  const visibleEntries = useMemo(() => {
    let list = activeCategory ? entries.filter((e) => e.categoryId === activeCategory) : entries
    const kw = keyword.trim().toLowerCase()
    if (kw) {
      list = list.filter((e) => `${e.title} ${e.content} ${e.tags.join(' ')}`.toLowerCase().includes(kw))
    }
    return [...list].sort((a, b) => b.updatedAt - a.updatedAt)
  }, [entries, activeCategory, keyword])

  const createCategory = async (): Promise<void> => {
    setCatDialog({ mode: 'create', name: '' })
  }

  const renameCategory = async (c: KnowledgeCategory): Promise<void> => {
    setCatDialog({ mode: 'rename', id: c.id, name: c.name })
  }

  const saveCategoryDialog = async (): Promise<void> => {
    if (!catDialog || !catDialog.name.trim()) return
    if (catDialog.mode === 'create') {
      await window.dshw.knowledgeCategoryCreate(catDialog.name)
    } else if (catDialog.id) {
      await window.dshw.knowledgeCategoryRename(catDialog.id, catDialog.name)
    }
    setCatDialog(null)
    await refresh()
  }

  const deleteCategory = async (c: KnowledgeCategory): Promise<void> => {
    if (confirm(`删除分类「${c.name}」？其下 ${c.entryCount} 条知识将一并删除。`)) {
      await window.dshw.knowledgeCategoryDelete(c.id)
      if (activeCategory === c.id) setActiveCategory(null)
      await refresh()
    }
  }

  const doIterate = async (): Promise<void> => {
    setBusy(true)
    try {
      const result = await window.dshw.knowledgeIterate()
      if (result.ok) {
        setIterateMsg(result.message)
        await refresh()
      }
    } finally {
      setBusy(false)
    }
  }

  const activeCategoryObj = categories.find((c) => c.id === activeCategory) ?? null

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* 顶栏：标题 + 搜索 + 迭代 */}
      <div className="flex items-center gap-3 border-b border-cyber-border px-4 py-3">
        <div>
          <h2 className="text-base font-bold text-cyber-text">知识库</h2>
          <p className="text-[11px] text-cyber-dim">从会话提炼的碎片化知识 · 自动打时间戳与关键词标签</p>
        </div>
        <div className="flex-1" />
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-cyber-faint" />
          <Input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="关键词模糊检索…"
            className="h-8 w-56 pl-8 text-xs"
          />
        </div>
        <Button size="sm" variant="outline" onClick={() => void doIterate()} disabled={busy}>
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} 合并去重
        </Button>
      </div>
      {iterateMsg && <div className="border-b border-cyber-border bg-cyber-green/10 px-4 py-1.5 text-xs text-cyber-green">{iterateMsg}</div>}

      <div className="flex min-h-0 flex-1">
        {/* 分类列 */}
        <div className="w-60 shrink-0 space-y-2 overflow-y-auto border-r border-cyber-border p-3">
          <button className="dashed-add min-h-[64px]" onClick={() => void createCategory()}>
            <Plus className="h-5 w-5" />
            <span className="text-xs">新增分类</span>
          </button>
          {categories.map((c) => (
            <div
              key={c.id}
              onClick={() => setActiveCategory(activeCategory === c.id ? null : c.id)}
              className={cn(
                'group relative cursor-pointer rounded-lg border p-3 transition-all',
                activeCategory === c.id
                  ? 'glow-border border-cyber-neon/60 bg-cyber-neon/10'
                  : 'border-cyber-border bg-cyber-panel hover:border-cyber-neon/40'
              )}
            >
              {activeCategory === c.id && <div className="flow-line absolute bottom-0 left-2 right-2 h-px" />}
              <div className="flex items-center gap-2">
                <Database className="h-4 w-4 text-cyber-neon" />
                <span className="flex-1 truncate text-xs font-medium text-cyber-text">{c.name}</span>
                <Badge variant="outline" className="px-1.5 text-[10px]">{c.entryCount}</Badge>
              </div>
              <div className="mt-2 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                <button aria-label="重命名" className="rounded p-1 text-cyber-dim hover:text-cyber-neon" onClick={(e) => { e.stopPropagation(); void renameCategory(c) }}>
                  <Pencil className="h-3 w-3" />
                </button>
                <button aria-label="删除" className="rounded p-1 text-cyber-dim hover:text-cyber-red" onClick={(e) => { e.stopPropagation(); void deleteCategory(c) }}>
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            </div>
          ))}
        </div>

        {/* 条目区 */}
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {visibleEntries.length === 0 && (
            <div className="py-16 text-center">
              <BookOpen className="mx-auto h-8 w-8 text-cyber-faint" />
              <p className="mt-2 text-xs text-cyber-dim">
                {activeCategoryObj ? `分类「${activeCategoryObj.name}」还没有知识条目` : '暂无知识条目'}
                —— 去「核心工作台」点「提炼为知识」吧
              </p>
            </div>
          )}
          <div className="space-y-2">
            {visibleEntries.map((e) => (
              <EntryCard key={e.id} entry={e} categoryName={categories.find((c) => c.id === e.categoryId)?.name ?? ''} onChanged={() => void refresh()} />
            ))}
          </div>
        </div>
      </div>

      {/* 分类创建 / 重命名对话框 */}
      <Dialog open={catDialog !== null} onOpenChange={(open) => !open && setCatDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{catDialog?.mode === 'rename' ? '重命名分类' : '新建分类'}</DialogTitle>
            <DialogDescription>分类用于组织提炼的知识条目。</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Input
              placeholder="分类名称"
              value={catDialog?.name ?? ''}
              onChange={(e) => setCatDialog((d) => (d ? { ...d, name: e.target.value } : d))}
              onKeyDown={(e) => e.key === 'Enter' && void saveCategoryDialog()}
              autoFocus
            />
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="ghost" onClick={() => setCatDialog(null)}>取消</Button>
              <Button size="sm" variant="default" onClick={() => void saveCategoryDialog()} disabled={!catDialog?.name.trim()}>
                保存
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function EntryCard({ entry, categoryName, onChanged }: { entry: KnowledgeEntry; categoryName: string; onChanged: () => void }): JSX.Element {
  const [editOpen, setEditOpen] = useState(false)
  const [title, setTitle] = useState(entry.title)
  const [content, setContent] = useState(entry.content)

  const doSave = async (): Promise<void> => {
    await window.dshw.knowledgeEntryUpdate(entry.id, { title, content })
    setEditOpen(false)
    onChanged()
  }
  const doDelete = async (): Promise<void> => {
    if (confirm(`删除知识「${entry.title}」？`)) {
      await window.dshw.knowledgeEntryDelete(entry.id)
      onChanged()
    }
  }

  return (
    <div className="sticky-card group">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <span className="text-sm font-medium text-cyber-text">{entry.title}</span>
          <span className="ml-2 text-[10px] text-cyber-faint">{categoryName}</span>
        </div>
        <div className="flex shrink-0 gap-1 opacity-0 transition-opacity group-hover:opacity-100">
          <button aria-label="编辑" className="rounded p-1 text-cyber-dim hover:text-cyber-neon" onClick={() => setEditOpen(true)}>
            <Pencil className="h-3.5 w-3.5" />
          </button>
          <button aria-label="删除" className="rounded p-1 text-cyber-dim hover:text-cyber-red" onClick={() => void doDelete()}>
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      <p className="mt-1.5 line-clamp-3 text-xs leading-relaxed text-cyber-dim">{entry.content}</p>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {entry.tags.map((t) => (
          <Badge key={t} variant="violet" className="px-1.5 py-0 text-[10px]">{t}</Badge>
        ))}
        <span className="ml-auto text-[10px] text-cyber-faint">
          {new Date(entry.updatedAt).toLocaleString('zh-CN', { hour12: false })}
        </span>
      </div>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>编辑知识</DialogTitle>
            <DialogDescription>标题与内容支持手动修正（标签由提炼时自动生成）。</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Input value={title} onChange={(e) => setTitle(e.target.value)} />
            <Textarea value={content} onChange={(e) => setContent(e.target.value)} className="min-h-[140px] text-xs" />
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="ghost" onClick={() => setEditOpen(false)}>取消</Button>
              <Button size="sm" variant="default" onClick={() => void doSave()}>保存</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
