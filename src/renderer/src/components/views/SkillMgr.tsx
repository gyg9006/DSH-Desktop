import { useCallback, useEffect, useState } from 'react'

import type { JSX } from 'react'
import { Search, RefreshCw, Download, Trash2, Loader2, Flame } from 'lucide-react'
import type { InstalledPluginPayload, InstalledSkillInfo, NpmPluginHitPayload, PluginStatePayload, SkillMarketItem } from '@shared/ipc'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs'
import { Button } from '../ui/button'
import { Badge } from '../ui/badge'
import { Input } from '../ui/input'
import { Switch } from '../ui/switch'

/**
 * 模块5：Skill 管理 —— Tab 切换 [插件市场] [技能市场] [已安装]。
 * 市场：在线搜索 + Top 推荐标记（前 10 🔥 推荐）+ 刷新 + 安装；
 * 已安装：两列展示已安装插件 / 已安装技能，支持卸载、启用开关。
 */
export function SkillMgr(): JSX.Element {
  const [plugins, setPlugins] = useState<PluginStatePayload[]>([])
  const [installedPlugins, setInstalledPlugins] = useState<InstalledPluginPayload[]>([])
  const [skills, setSkills] = useState<SkillMarketItem[]>([])
  const [installedSkills, setInstalledSkills] = useState<InstalledSkillInfo[]>([])
  const [busy, setBusy] = useState<string | null>(null)

  const refresh = useCallback(async (): Promise<void> => {
    const p = await window.dshw.getPlugins()
    setPlugins(p.curated)
    setInstalledPlugins(p.installed)
    const s = await window.dshw.getSkills()
    setSkills(s.items)
    setInstalledSkills(s.installed)
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return (
    <div className="flex h-full flex-col p-5">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-cyber-text">Skill 管理</h2>
          <p className="text-xs text-cyber-dim">插件（dsh 功能扩展）与技能（对话 SKILL.md）市场，联网搜索安装</p>
        </div>
        <Button size="sm" variant="outline" onClick={() => void refresh()}>
          <RefreshCw className="h-3.5 w-3.5" /> 刷新
        </Button>
      </div>

      <Tabs defaultValue="plugins" className="flex min-h-0 flex-1 flex-col">
        <TabsList>
          <TabsTrigger value="plugins">插件市场</TabsTrigger>
          <TabsTrigger value="skills">技能市场</TabsTrigger>
          <TabsTrigger value="installed">已安装</TabsTrigger>
        </TabsList>

        <TabsContent value="plugins" className="min-h-0 flex-1 overflow-y-auto">
          <PluginMarket
            curated={plugins}
            installed={installedPlugins}
            busy={busy}
            setBusy={setBusy}
            onChanged={() => void refresh()}
          />
        </TabsContent>

        <TabsContent value="skills" className="min-h-0 flex-1 overflow-y-auto">
          <SkillMarket skills={skills} installed={installedSkills} busy={busy} setBusy={setBusy} onChanged={() => void refresh()} />
        </TabsContent>

        <TabsContent value="installed" className="min-h-0 flex-1 overflow-y-auto">
          <InstalledView
            installedPlugins={installedPlugins}
            installedSkills={installedSkills}
            busy={busy}
            setBusy={setBusy}
            onChanged={() => void refresh()}
          />
        </TabsContent>
      </Tabs>
    </div>
  )
}

// ---------------- 插件市场 ----------------
function PluginMarket({
  curated,
  installed,
  busy,
  setBusy,
  onChanged
}: {
  curated: PluginStatePayload[]
  installed: InstalledPluginPayload[]
  busy: string | null
  setBusy: (v: string | null) => void
  onChanged: () => void
}): JSX.Element {
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<NpmPluginHitPayload[]>([])
  const [searched, setSearched] = useState(false)

  const doSearch = async (): Promise<void> => {
    if (!query.trim()) return
    setSearched(true)
    const result = await window.dshw.searchPlugins(query)
    setHits(result.ok ? result.hits : [])
  }

  const doInstall = async (pkg: NpmPluginHitPayload): Promise<void> => {
    setBusy(pkg.name)
    try {
      if (!confirm(`从 npm 安装 ${pkg.name}@${pkg.version}？`)) return
      const result = await window.dshw.installPlugin(`${pkg.name}@${pkg.version}`)
      alert(result.ok ? (result.bundle ? '插件已安装（重启服务生效）' : '安装完成') : (result.error ?? '安装失败'))
      onChanged()
    } finally {
      setBusy(null)
    }
  }

  const isInstalled = (name: string): boolean => installed.some((p) => p.name === name)

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-cyber-faint" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void doSearch()}
            placeholder="联网搜索插件：按名字或功能词（如「搜索」「数据库」「mcp」）"
            className="h-8 pl-8 text-xs"
          />
        </div>
        <Button size="sm" variant="default" onClick={() => void doSearch()} disabled={!query.trim()}>
          搜索
        </Button>
      </div>

      {searched && hits.length > 0 && (
        <div>
          <div className="mb-1.5 text-[11px] font-medium text-cyber-dim">联网搜索结果（{hits.length}）</div>
          <div className="space-y-1.5">
            {hits.map((h, i) => (
              <div key={h.name} className="flex items-center justify-between gap-3 rounded-lg border border-cyber-border bg-cyber-panel/60 px-3 py-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    {i < 10 && <Flame className="h-3.5 w-3.5 text-cyber-amber" />}
                    <span className="font-mono text-xs font-semibold text-cyber-text">{h.name}</span>
                    <span className="text-[10px] text-cyber-faint">v{h.version}</span>
                    {isInstalled(h.name) && <Badge variant="green" className="px-1.5 text-[10px]">已安装</Badge>}
                  </div>
                  <p className="truncate text-[11px] text-cyber-dim">{h.description || '（无描述）'}</p>
                </div>
                {!isInstalled(h.name) ? (
                  <Button size="sm" variant="outline" className="h-7 shrink-0 px-2 text-[11px]" onClick={() => void doInstall(h)} disabled={busy === h.name}>
                    {busy === h.name ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />} 安装
                  </Button>
                ) : (
                  <span className="shrink-0 text-[10px] text-cyber-faint">已安装</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="mb-1 text-[11px] font-medium text-cyber-dim">内置推荐插件（{curated.length}）</div>
      <div className="space-y-1.5">
        {curated.map((p, i) => (
          <div key={p.name} className="flex items-center justify-between gap-3 rounded-lg border border-cyber-border bg-cyber-panel/60 px-3 py-2">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                {i < 10 && <Badge variant="hot" className="px-1.5 text-[10px]">🔥 推荐</Badge>}
                <span className="text-xs font-semibold text-cyber-text">{p.title}</span>
                {p.enabledInBundle && <Badge variant="green" className="px-1.5 text-[10px]">随 dsh 加载</Badge>}
                {!p.enabledInBundle && p.enabledByUser && <Badge variant="default" className="px-1.5 text-[10px]">已启用</Badge>}
              </div>
              <p className="truncate text-[11px] text-cyber-dim">{p.description}</p>
            </div>
            {!p.enabledInBundle && (
              <Switch
                checked={p.enabledByUser}
                onCheckedChange={async (v) => {
                  await window.dshw.setPluginEnabled(p.name, v)
                  onChanged()
                }}
              />
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

// ---------------- 技能市场 ----------------
function SkillMarket({
  skills,
  installed,
  busy,
  setBusy,
  onChanged
}: {
  skills: SkillMarketItem[]
  installed: InstalledSkillInfo[]
  busy: string | null
  setBusy: (v: string | null) => void
  onChanged: () => void
}): JSX.Element {
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<Array<{ name: string; description: string; keywords: string[] }>>([])
  const [searched, setSearched] = useState(false)

  const doSearch = async (): Promise<void> => {
    if (!query.trim()) return
    setSearched(true)
    const result = await window.dshw.searchSkills(query)
    setHits(result.ok ? result.hits : [])
  }

  const doInstallNpm = async (name: string): Promise<void> => {
    setBusy(name)
    try {
      if (!confirm(`从 npm 安装技能包 ${name}？`)) return
      const result = await window.dshw.installSkillNpm(name)
      alert(result.ok ? `技能已安装：${(result.installed ?? []).join('、') || name}` : (result.error ?? '安装失败'))
      onChanged()
    } finally {
      setBusy(null)
    }
  }

  const doInstall = async (s: SkillMarketItem): Promise<void> => {
    setBusy(s.id)
    try {
      if (!confirm(`安装技能「${s.name}」？`)) return
      const result = await window.dshw.installSkill(s.id)
      alert(result.ok ? `技能已安装：${(result.installed ?? []).join('、') || s.name}` : (result.error ?? '安装失败'))
      onChanged()
    } finally {
      setBusy(null)
    }
  }

  const installedIds = new Set(installed.map((i) => i.id))

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-cyber-faint" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void doSearch()}
            placeholder="联网搜索技能：按名字或功能词（如「pdf」「代码审查」）"
            className="h-8 pl-8 text-xs"
          />
        </div>
        <Button size="sm" variant="default" onClick={() => void doSearch()} disabled={!query.trim()}>
          搜索
        </Button>
      </div>

      {searched && hits.length > 0 && (
        <div>
          <div className="mb-1.5 text-[11px] font-medium text-cyber-dim">联网搜索结果（{hits.length}）</div>
          <div className="space-y-1.5">
            {hits.map((h) => (
              <div key={h.name} className="flex items-center justify-between gap-3 rounded-lg border border-cyber-border bg-cyber-panel/60 px-3 py-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs font-semibold text-cyber-text">{h.name}</span>
                    <Badge variant="violet" className="px-1.5 text-[10px]">npm 技能包</Badge>
                  </div>
                  <p className="truncate text-[11px] text-cyber-dim">{h.description || '（无描述）'}</p>
                </div>
                <Button size="sm" variant="outline" className="h-7 shrink-0 px-2 text-[11px]" onClick={() => void doInstallNpm(h.name)} disabled={busy === h.name}>
                  {busy === h.name ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />} 安装
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="mb-1 text-[11px] font-medium text-cyber-dim">精选推荐技能（{skills.length}）</div>
      <div className="space-y-1.5">
        {skills.map((s, i) => (
          <div key={s.id} className="flex items-center justify-between gap-3 rounded-lg border border-cyber-border bg-cyber-panel/60 px-3 py-2">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                {i < 10 && <Badge variant="hot" className="px-1.5 text-[10px]">🔥 推荐</Badge>}
                <span className="text-xs font-semibold text-cyber-text">{s.name}</span>
                {installedIds.has(s.id) && <Badge variant="green" className="px-1.5 text-[10px]">已安装</Badge>}
              </div>
              <p className="truncate text-[11px] text-cyber-dim">{s.description}</p>
            </div>
            {!installedIds.has(s.id) ? (
              <Button size="sm" variant="outline" className="h-7 shrink-0 px-2 text-[11px]" onClick={() => void doInstall(s)} disabled={busy === s.id}>
                {busy === s.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />} 安装
              </Button>
            ) : (
              <span className="shrink-0 text-[10px] text-cyber-faint">已安装</span>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

// ---------------- 已安装 ----------------
function InstalledView({
  installedPlugins,
  installedSkills,
  busy,
  setBusy,
  onChanged
}: {
  installedPlugins: InstalledPluginPayload[]
  installedSkills: InstalledSkillInfo[]
  busy: string | null
  setBusy: (v: string | null) => void
  onChanged: () => void
}): JSX.Element {
  const doUninstall = async (pkg: InstalledPluginPayload): Promise<void> => {
    setBusy(pkg.name)
    try {
      if (!confirm(`卸载插件 ${pkg.name}？`)) return
      const result = await window.dshw.uninstallPlugin(pkg.name)
      alert(result.ok ? '卸载完成（重启服务生效）' : (result.error ?? '卸载失败'))
      onChanged()
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="grid grid-cols-2 gap-4">
      <div>
        <div className="mb-2 text-[11px] font-medium text-cyber-dim">已安装插件（{installedPlugins.length}）</div>
        {installedPlugins.length === 0 && <div className="py-6 text-center text-xs text-cyber-faint">暂无 npm 安装的插件</div>}
        <div className="space-y-1.5">
          {installedPlugins.map((p) => (
            <div key={p.name} className="flex items-center justify-between rounded-lg border border-cyber-border bg-cyber-panel/60 px-3 py-2">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs font-semibold text-cyber-text">{p.name}</span>
                  <span className="text-[10px] text-cyber-faint">v{p.version}</span>
                </div>
              </div>
              <Button size="sm" variant="ghost" className="h-6 px-2 text-[11px] text-cyber-red" onClick={() => void doUninstall(p)} disabled={busy === p.name}>
                <Trash2 className="h-3 w-3" /> 卸载
              </Button>
            </div>
          ))}
        </div>
      </div>
      <div>
        <div className="mb-2 text-[11px] font-medium text-cyber-dim">已安装技能（{installedSkills.length}，workspace/skills）</div>
        {installedSkills.length === 0 && <div className="py-6 text-center text-xs text-cyber-faint">暂无已安装技能</div>}
        <div className="space-y-1.5">
          {installedSkills.map((s) => (
            <div key={s.id} className="flex items-center justify-between rounded-lg border border-cyber-border bg-cyber-panel/60 px-3 py-2">
              <span className="font-mono text-xs text-cyber-text">{s.id}</span>
              <span className="text-[10px] text-cyber-faint">{(s.sizeBytes / 1024).toFixed(1)} KB</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
