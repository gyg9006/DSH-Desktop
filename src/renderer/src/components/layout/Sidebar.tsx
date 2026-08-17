import type { LucideIcon } from 'lucide-react'

import type { JSX } from 'react'
import {
  LayoutGrid,
  StickyNote,
  Bot,
  Database,
  Puzzle,
  Settings,
  Zap
} from 'lucide-react'
import { cn } from '../../lib/utils'

export type ViewKey = 'workbench' | 'sessions' | 'agents' | 'knowledge' | 'skills' | 'settings'

export interface NavItem {
  key: ViewKey
  name: string
  desc: string
  icon: LucideIcon
}

export const NAV_ITEMS: NavItem[] = [
  { key: 'workbench', name: '核心工作台', desc: 'DSH 对话 / 会话操作', icon: LayoutGrid },
  { key: 'sessions', name: '会话管理', desc: '便签式分组卡片', icon: StickyNote },
  { key: 'agents', name: 'Agent 管理', desc: 'GitHub Agent 项目', icon: Bot },
  { key: 'knowledge', name: '知识库', desc: '提炼 / 检索 / 迭代', icon: Database },
  { key: 'skills', name: 'Skill 管理', desc: '插件 / 技能市场', icon: Puzzle },
  { key: 'settings', name: '设置', desc: '通用 / 外观 / 高级', icon: Settings }
]

interface SidebarProps {
  active: ViewKey
  onSelect: (key: ViewKey) => void
}

/**
 * v2.0 左侧导航：6 个功能入口 + 底部状态区。
 * 选中态：nav-item-active（霓虹边框 + 左侧流光指示条）。
 */
export function Sidebar({ active, onSelect }: SidebarProps): JSX.Element {
  return (
    <aside className="relative flex h-full w-56 shrink-0 flex-col border-r border-cyber-border bg-cyber-panel/60 backdrop-blur-glass">
      <div className="flex-1 space-y-1 overflow-y-auto p-3">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon
          const isActive = active === item.key
          return (
            <button
              key={item.key}
              onClick={() => onSelect(item.key)}
              className={cn(
                'group relative flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-all',
                isActive ? 'nav-item-active' : 'text-cyber-dim hover:bg-white/5 hover:text-cyber-text'
              )}
            >
              <Icon className={cn('h-[18px] w-[18px] shrink-0', isActive && 'drop-shadow-[0_0_6px_rgba(0,229,255,0.8)]')} />
              <span className="min-w-0">
                <span className="block text-sm font-medium">{item.name}</span>
                <span className="block truncate text-[10px] text-cyber-faint">{item.desc}</span>
              </span>
            </button>
          )
        })}
      </div>

      {/* 底部状态区 */}
      <div className="border-t border-cyber-border p-3">
        <div className="glass-panel flex items-center gap-2 px-3 py-2">
          <Zap className="h-3.5 w-3.5 text-cyber-amber" />
          <div className="min-w-0">
            <div className="text-[11px] font-medium text-cyber-text">DSH Desktop v2.0</div>
            <div className="text-[9px] text-cyber-faint">DeepSeek Harness 便携客户端</div>
          </div>
        </div>
      </div>
    </aside>
  )
}
