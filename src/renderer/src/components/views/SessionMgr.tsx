import { useCallback, useEffect, useState } from 'react'

import type { JSX } from 'react'
import { Plus, Folder, Star, StarOff, Trash2, Pencil, ArrowLeft, ArrowUpRight } from 'lucide-react'
import type { SessionGroupInfo, SidebarDataPayload, WorkspaceEntryPayload } from '@shared/ipc'
import { Button } from '../ui/button'
import { Badge } from '../ui/badge'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../ui/dialog'
import { Input } from '../ui/input'
import { cn } from '../../lib/utils'

interface SessionItem {
  id: string
  title: string
  time: number
}

/**
 * 模块2：会话管理 —— 便签式分组卡片视图。
 * 分组卡片网格（首位 [+ 新增分组]）→ 点击进入分组查看会话列表 →
 * 会话操作（重命名 / 移动 / 收藏 / 删除 / 返回工作区）。
 */
export function SessionMgr(): JSX.Element {
  const [data, setData] = useState<SidebarDataPayload | null>(null)
  const [currentGroup, setCurrentGroup] = useState<SessionGroupInfo | null>(null)
  const [groupSessions, setGroupSessions] = useState<SessionItem[]>([])
  const [ungrouped, setUngrouped] = useState<SessionItem[]>([])

  const refresh = useCallback(async (): Promise<void> => {
    const payload = await window.dshw.getSidebarData()
    setData(payload)
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  // 展开分组时组装会话列表
  const openGroup = useCallback(
    (group: SessionGroupInfo): void => {
      setCurrentGroup(group)
      const all: SessionItem[] = []
      for (const ws of data?.workspaces ?? []) {
        for (const s of ws.sessions) {
          if (!s.blank && data?.groupMap[s.id] === group.id) {
            all.push({ id: s.id, title: s.title, time: s.time })
          }
        }
      }
      setGroupSessions(all)
    },
    [data]
  )

  const closeGroup = useCallback((): void => {
    setCurrentGroup(null)
    void refresh()
  }, [refresh])

  // 未分组会话（便于拖入分组 / 返回工作区后可见）
  useEffect(() => {
    if (currentGroup) return
    const all: SessionItem[] = []
    for (const ws of data?.workspaces ?? []) {
      for (const s of ws.sessions) {
        if (!s.blank && (data?.groupMap[s.id] ?? null) === null) {
          all.push({ id: s.id, title: s.title, time: s.time })
        }
      }
    }
    setUngrouped(all.sort((a, b) => b.time - a.time))
  }, [data, currentGroup])

  if (!data) return <div className="flex h-full items-center justify-center text-cyber-dim">加载中…</div>

  // 返回分组网格
  if (currentGroup) {
    return (
      <GroupDetail
        group={currentGroup}
        sessions={groupSessions}
        groups={data.groups}
        onBack={closeGroup}
        onChanged={() => void refresh()}
      />
    )
  }

  return (
    <div className="h-full overflow-y-auto p-5">
      <div className="mb-4">
        <h2 className="text-lg font-bold text-cyber-text">会话管理</h2>
        <p className="text-xs text-cyber-dim">便签式分组卡片 · 点击分组查看会话 · 会话支持重命名 / 收藏 / 移动 / 删除</p>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
        <CreateGroupCard workspaces={data.workspaces} onCreated={() => void refresh()} />
        {data.groups.map((g) => (
          <GroupCard key={g.id} group={g} sessions={countSessions(data, g.id)} onOpen={() => openGroup(g)} onChanged={() => void refresh()} />
        ))}
      </div>

      {ungrouped.length > 0 && (
        <div className="mt-8">
          <div className="mb-2 flex items-center gap-2 text-xs text-cyber-dim">
            <ArrowUpRight className="h-3.5 w-3.5" /> 未分组会话（{ungrouped.length}）
          </div>
          <div className="space-y-1">
            {ungrouped.slice(0, 12).map((s) => (
              <div key={s.id} className="flex items-center justify-between rounded-lg border border-cyber-border bg-cyber-panel/60 px-3 py-2">
                <span className="truncate text-xs text-cyber-text">{s.title || '(无标题会话)'}</span>
                <span className="ml-2 shrink-0 text-[10px] text-cyber-faint">{new Date(s.time).toLocaleDateString()}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function countSessions(data: SidebarDataPayload, groupId: string): number {
  let n = 0
  for (const ws of data.workspaces) for (const s of ws.sessions) if (!s.blank && data.groupMap[s.id] === groupId) n++
  return n
}

function GroupCard({
  group,
  sessions,
  onOpen,
  onChanged
}: {
  group: SessionGroupInfo
  sessions: number
  onOpen: () => void
  onChanged: () => void
}): JSX.Element {
  const [renameOpen, setRenameOpen] = useState(false)
  const [name, setName] = useState(group.name)

  const doRename = async (): Promise<void> => {
    await window.dshw.renameSessionGroup(group.id, name)
    setRenameOpen(false)
    onChanged()
  }
  const doDelete = async (): Promise<void> => {
    if (confirm(`删除分组「${group.name}」？组内会话将移回工作文件夹（不丢失）。`)) {
      await window.dshw.deleteSessionGroup(group.id, false)
      onChanged()
    }
  }

  return (
    <div className="sticky-card group relative">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2">
          <Folder className={cn('h-5 w-5', group.pinned ? 'text-cyber-amber' : 'text-cyber-neon')} />
          <span className="text-sm font-semibold text-cyber-text">{group.name}</span>
        </div>
        <div className="flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
          <button aria-label="重命名" className="rounded p-1 text-cyber-dim hover:text-cyber-neon" onClick={() => setRenameOpen(true)}>
            <Pencil className="h-3.5 w-3.5" />
          </button>
          <button aria-label="删除" className="rounded p-1 text-cyber-dim hover:text-cyber-red" onClick={() => void doDelete()}>
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      <div className="mt-3 flex items-center justify-between">
        <Badge variant="outline">{sessions} 个会话</Badge>
        <Button size="sm" variant="ghost" onClick={onOpen}>
          查看会话
        </Button>
      </div>
      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>重命名分组</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Input value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void doRename()} />
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="ghost" onClick={() => setRenameOpen(false)}>取消</Button>
              <Button size="sm" variant="default" onClick={() => void doRename()}>保存</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function CreateGroupCard({ workspaces, onCreated }: { workspaces: WorkspaceEntryPayload[]; onCreated: () => void }): JSX.Element {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [wsId, setWsId] = useState(workspaces[0]?.id ?? '')

  const doCreate = async (): Promise<void> => {
    if (!name.trim() || !wsId) return
    const result = await window.dshw.createSessionGroup(name, wsId)
    if (result.ok) {
      setOpen(false)
      setName('')
      onCreated()
    } else {
      alert(result.error ?? '创建失败')
    }
  }

  return (
    <>
      <button className="dashed-add min-h-[96px]" onClick={() => setOpen(true)}>
        <Plus className="h-6 w-6" />
        <span className="text-sm">新增分组</span>
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>新建会话分组</DialogTitle>
            <DialogDescription>分组用于整理工作文件夹中的会话。</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Input placeholder="分组名称" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void doCreate()} />
            <select
              value={wsId}
              onChange={(e) => setWsId(e.target.value)}
              className="h-9 w-full rounded-lg border border-cyber-border bg-cyber-panel2 px-2 text-sm text-cyber-text focus:border-cyber-neon/60 focus:outline-none"
            >
              {workspaces.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.title}
                </option>
              ))}
            </select>
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>取消</Button>
              <Button size="sm" variant="default" onClick={() => void doCreate()} disabled={!name.trim() || !wsId}>创建</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}

/** 分组详情：会话列表 + 操作（重命名/收藏/移动/删除/返回工作区）。 */
function GroupDetail({
  group,
  sessions,
  groups,
  onBack,
  onChanged
}: {
  group: SessionGroupInfo
  sessions: SessionItem[]
  groups: SessionGroupInfo[]
  onBack: () => void
  onChanged: () => void
}): JSX.Element {
  const [favorites, setFavorites] = useState<string[]>([])

  useEffect(() => {
    void window.dshw.getSidebarData().then((d) => setFavorites(d.favorites))
  }, [sessions])

  const doMove = async (sessionId: string, groupId: string | null): Promise<void> => {
    await window.dshw.moveSessionToGroup(sessionId, groupId)
    onChanged()
  }
  const doDelete = async (sessionId: string): Promise<void> => {
    if (confirm('删除该会话？（数据不可恢复）')) {
      await window.dshw.deleteSession(sessionId)
      onChanged()
    }
  }
  const doFavorite = async (sessionId: string, fav: boolean): Promise<void> => {
    await window.dshw.setSessionFavorite(sessionId, fav)
    onChanged()
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-cyber-border px-4 py-3">
        <Button size="sm" variant="ghost" onClick={onBack}>
          <ArrowLeft className="h-3.5 w-3.5" /> 返回
        </Button>
        <Folder className="h-4 w-4 text-cyber-neon" />
        <span className="text-sm font-semibold text-cyber-text">{group.name}</span>
        <Badge variant="outline">{sessions.length} 个会话</Badge>
      </div>
      <div className="min-h-0 flex-1 space-y-1 overflow-y-auto p-4">
        {sessions.length === 0 && <div className="py-10 text-center text-xs text-cyber-dim">该分组还没有会话</div>}
        {sessions.map((s) => (
          <div key={s.id} className="flex items-center gap-2 rounded-lg border border-cyber-border bg-cyber-panel/60 px-3 py-2 transition-colors hover:border-cyber-neon/40">
            <span className={cn('min-w-0 flex-1 truncate text-xs', favorites.includes(s.id) ? 'text-cyber-amber' : 'text-cyber-text')}>
              {s.title || '(无标题会话)'}
            </span>
            <span className="shrink-0 text-[10px] text-cyber-faint">{new Date(s.time).toLocaleDateString()}</span>
            <button aria-label="收藏" className="rounded p-1 text-cyber-dim hover:text-cyber-amber" onClick={() => void doFavorite(s.id, !favorites.includes(s.id))}>
              {favorites.includes(s.id) ? <Star className="h-3.5 w-3.5 text-cyber-amber" /> : <StarOff className="h-3.5 w-3.5" />}
            </button>
            <select
              aria-label="移动到分组"
              value=""
              onChange={(e) => e.target.value && void doMove(s.id, e.target.value === '__none' ? null : e.target.value)}
              className="h-7 rounded-md border border-cyber-border bg-cyber-panel2 px-1.5 text-[11px] text-cyber-dim focus:outline-none"
            >
              <option value="">移动到…</option>
              <option value="__none">返回工作区</option>
              {groups.filter((g) => g.id !== group.id).map((g) => (
                <option key={g.id} value={g.id}>{g.name}</option>
              ))}
            </select>
            <button aria-label="删除" className="rounded p-1 text-cyber-dim hover:text-cyber-red" onClick={() => void doDelete(s.id)}>
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
