import type { LucideIcon } from 'lucide-react'
import type { JSX } from 'react'
import {
  LayoutGrid,
  Bot,
  Database,
  Puzzle,
  Settings,
  Zap
} from 'lucide-react'
import { cn } from '../../lib/utils'

export type ViewKey = 'workbench' | 'agents' | 'knowledge' | 'skills' | 'settings'

export interface NavItem {
  key: ViewKey
  name: string
  desc: string
  icon: LucideIcon
}

export const NAV_ITEMS: NavItem[] = [
  { key: 'workbench', name: '核心工作台', desc: 'DSH 对话 / 会话操作', icon: LayoutGrid },
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
 * v2.0 侧边导航栏：窄图标栏（56px），科技感统一。
 * 选中态：霓虹边框 + 左侧流光指示条；悬停 tooltip 显示模块名与描述。
 */
export function Sidebar({ active, onSelect }: SidebarProps): JSX.Element {
  return (
    <aside className="relative flex h-full w-14 shrink-0 flex-col items-center border-r border-cyber-border bg-cyber-panel/60 backdrop-blur-glass">
      <div className="flex w-full flex-1 flex-col items-center gap-1 overflow-y-auto py-3">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon
          const isActive = active === item.key
          return (
            <button
              key={item.key}
              onClick={() => onSelect(item.key)}
              title={`${item.name}\n${item.desc}`}
              aria-label={item.name}
              className={cn(
                'group relative flex h-10 w-10 items-center justify-center rounded-lg transition-all',
                isActive
                  ? 'nav-item-active'
                  : 'text-cyber-dim hover:bg-white/5 hover:text-cyber-text'
              )}
            >
              <Icon
                className={cn(
                  'h-[18px] w-[18px]',
                  isActive && 'drop-shadow-[0_0_6px_rgba(0,229,255,0.8)]'
                )}
              />
              {/* 悬停 tooltip */}
              <span
                className={cn(
                  'pointer-events-none absolute left-[120%] z-50 whitespace-nowrap rounded-lg border border-cyber-border bg-cyber-panel px-2.5 py-1.5 text-xs opacity-0 shadow-glass transition-opacity group-hover:opacity-100',
                  isActive ? 'text-cyber-neon' : 'text-cyber-text'
                )}
              >
                <span className="block font-medium">{item.name}</span>
                <span className="block text-[10px] text-cyber-faint">{item.desc}</span>
              </span>
            </button>
          )
        })}
      </div>

      {/* 底部状态区 */}
      <div className="flex flex-col items-center gap-1 border-t border-cyber-border py-2">
        <span
          className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-cyber-neon to-cyber-violet text-[10px] font-black text-cyber-bg shadow-glow-neon"
          title="DSH Desktop v2.0"
        >
          D
        </span>
        <Zap className="h-3 w-3 text-cyber-amber" />
      </div>
    </aside>
  )
}
