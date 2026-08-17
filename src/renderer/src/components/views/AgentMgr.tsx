import { useCallback, useEffect, useState } from 'react'

import type { JSX } from 'react'
import { Plus, Github, Trash2, Pencil, Play, Users, Loader2, Terminal } from 'lucide-react'
import type { AgentInfo } from '@shared/ipc'
import { Button } from '../ui/button'
import { Badge } from '../ui/badge'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../ui/dialog'
import { Input } from '../ui/input'

/**
 * 模块3：Agent 管理 —— 便签式卡片视图。
 * GitHub URL 导入 Agent 项目；点击卡片运行（骨架），多选协同工作（骨架日志流）。
 */
export function AgentMgr(): JSX.Element {
  const [agents, setAgents] = useState<AgentInfo[]>([])
  const [importOpen, setImportOpen] = useState(false)
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [logOpen, setLogOpen] = useState(false)
  const [log, setLog] = useState('')
  const [task, setTask] = useState('')
  const [runningId, setRunningId] = useState<string | null>(null)

  const refresh = useCallback(async (): Promise<void> => {
    const payload = await window.dshw.agentsGet()
    setAgents(payload.agents)
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const doImport = async (): Promise<void> => {
    setBusy(true)
    try {
      const result = await window.dshw.agentImport(url)
      if (result.ok) {
        setImportOpen(false)
        setUrl('')
        await refresh()
      } else {
        alert(result.error ?? '导入失败')
      }
    } finally {
      setBusy(false)
    }
  }

  const [renameTarget, setRenameTarget] = useState<AgentInfo | null>(null)
  const [renameName, setRenameName] = useState('')

  const doRename = (agent: AgentInfo): void => {
    setRenameTarget(agent)
    setRenameName(agent.name)
  }

  const saveRename = async (): Promise<void> => {
    if (!renameTarget || !renameName.trim()) return
    await window.dshw.agentRename(renameTarget.id, renameName)
    setRenameTarget(null)
    await refresh()
  }

  const doDelete = async (id: string, name: string): Promise<void> => {
    if (confirm(`删除 Agent「${name}」？`)) {
      await window.dshw.agentDelete(id)
      await refresh()
    }
  }

  const doRun = async (id: string): Promise<void> => {
    setRunningId(id)
    try {
      const result = await window.dshw.agentRun(id)
      setLog(result.log ?? (result.error ?? ''))
      setLogOpen(true)
    } finally {
      setRunningId(null)
    }
  }

  const doCollaborate = async (): Promise<void> => {
    if (selected.size < 2) {
      alert('请至少选择 2 个 Agent 进行协同')
      return
    }
    setBusy(true)
    try {
      const result = await window.dshw.agentsCollaborate({ agentIds: [...selected], task })
      if (result.ok) {
        setLog(result.log)
        setLogOpen(true)
        setTask('')
      } else {
        alert(result.error ?? '协同失败')
      }
    } finally {
      setBusy(false)
    }
  }

  const toggleSelect = (id: string): void => {
    const next = new Set(selected)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setSelected(next)
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto p-5">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-cyber-text">Agent 管理</h2>
          <p className="text-xs text-cyber-dim">从 GitHub 导入 Agent 项目，多选协同工作</p>
        </div>
        <div className="flex items-center gap-2">
          <Input
            value={task}
            onChange={(e) => setTask(e.target.value)}
            placeholder="协同任务描述…"
            className="h-8 w-56 text-xs"
          />
          <Button size="sm" variant="violet" onClick={() => void doCollaborate()} disabled={busy}>
            <Users className="h-3.5 w-3.5" /> 协同工作（{selected.size}）
          </Button>
          <Button size="sm" variant="default" onClick={() => setImportOpen(true)}>
            <Plus className="h-3.5 w-3.5" /> 新增 Agent
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
        <button className="dashed-add min-h-[120px]" onClick={() => setImportOpen(true)}>
          <Plus className="h-6 w-6" />
          <span className="text-sm">新增 Agent</span>
          <span className="text-[10px] text-cyber-faint">GitHub URL 导入</span>
        </button>
        {agents.map((a) => (
          <div
            key={a.id}
            onClick={() => toggleSelect(a.id)}
            className={`sticky-card group min-h-[120px] cursor-pointer ${selected.has(a.id) ? 'glow-border-violet' : ''}`}
          >
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-2">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-cyber-violet/40 to-cyber-neon/30">
                  <Github className="h-4 w-4 text-cyber-text" />
                </span>
                <span className="text-sm font-semibold text-cyber-text">{a.name}</span>
              </div>
              <Badge variant={a.status === 'running' ? 'green' : 'outline'}>
                {a.status === 'running' ? '运行中' : a.status === 'error' ? '异常' : '就绪'}
              </Badge>
            </div>
            <p className="mt-2 line-clamp-2 min-h-[32px] text-[11px] leading-relaxed text-cyber-dim">{a.description}</p>
            <div className="mt-2 truncate font-mono text-[10px] text-cyber-faint">{a.repoUrl}</div>
            <div className="mt-2 flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
              <Button size="sm" variant="ghost" className="h-6 px-2 text-[11px]" onClick={(e) => { e.stopPropagation(); void doRun(a.id) }} disabled={runningId === a.id}>
                {runningId === a.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />} 运行
              </Button>
              <Button size="sm" variant="ghost" className="h-6 px-2 text-[11px]" onClick={(e) => { e.stopPropagation(); doRename(a) }}>
                <Pencil className="h-3 w-3" /> 重命名
              </Button>
              <Button size="sm" variant="ghost" className="h-6 px-2 text-[11px] text-cyber-red" onClick={(e) => { e.stopPropagation(); void doDelete(a.id, a.name) }}>
                <Trash2 className="h-3 w-3" />
              </Button>
            </div>
          </div>
        ))}
      </div>

      {/* 导入对话框 */}
      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>导入 Agent 项目</DialogTitle>
            <DialogDescription>输入 GitHub 仓库地址，自动拉取仓库信息（公共仓库无需 Token）。</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Input
              placeholder="https://github.com/anthropics/superpowers"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void doImport()}
            />
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="ghost" onClick={() => setImportOpen(false)}>取消</Button>
              <Button size="sm" variant="default" onClick={() => void doImport()} disabled={busy || !url.trim()}>
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Github className="h-3.5 w-3.5" />} 导入
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* 运行 / 协同日志 */}
      <Dialog open={logOpen} onOpenChange={setLogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Terminal className="h-4 w-4 text-cyber-neon" /> 运行日志
            </DialogTitle>
          </DialogHeader>
          <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded-lg border border-cyber-border bg-cyber-bg p-3 font-mono text-[11px] leading-relaxed text-cyber-green">
            {log || '（空）'}
          </pre>
        </DialogContent>
      </Dialog>

      {/* 重命名对话框 */}
      <Dialog open={renameTarget !== null} onOpenChange={(open) => !open && setRenameTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>重命名 Agent</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Input value={renameName} onChange={(e) => setRenameName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void saveRename()} autoFocus />
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="ghost" onClick={() => setRenameTarget(null)}>取消</Button>
              <Button size="sm" variant="default" onClick={() => void saveRename()} disabled={!renameName.trim()}>保存</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
