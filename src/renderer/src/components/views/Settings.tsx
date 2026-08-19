import { useState } from 'react'
import type { JSX } from 'react'
import { Settings as SettingsIcon, Palette, Keyboard, Info, Cpu, ScrollText } from 'lucide-react'
import { cn } from '../../lib/utils'
import { GeneralSection } from './settings/GeneralSection'
import { AppearanceSection } from './settings/AppearanceSection'
import { ShortcutsSection } from './settings/ShortcutsSection'
import { AdvancedSection } from './settings/AdvancedSection'
import { AboutSection } from './settings/AboutSection'
import { RulesSection } from './settings/RulesSection'

type SettingSection = 'general' | 'appearance' | 'shortcuts' | 'about' | 'advanced' | 'rules'

const SECTIONS: Array<{ key: SettingSection; name: string; icon: typeof SettingsIcon }> = [
  { key: 'general', name: '通用', icon: SettingsIcon },
  { key: 'appearance', name: '外观', icon: Palette },
  { key: 'shortcuts', name: '快捷键', icon: Keyboard },
  { key: 'about', name: '关于', icon: Info },
  { key: 'advanced', name: '高级配置', icon: Cpu },
  { key: 'rules', name: '全局行为', icon: ScrollText }
]

/**
 * 模块6：设置 —— 左侧子菜单 + 右侧表单。
 * 通用、外观、快捷键、关于、高级配置、全局行为（永久指令）。
 */
export function Settings(): JSX.Element {
  const [section, setSection] = useState<SettingSection>('general')

  const renderSection = (): JSX.Element => {
    switch (section) {
      case 'general':
        return <GeneralSection />
      case 'appearance':
        return <AppearanceSection />
      case 'shortcuts':
        return <ShortcutsSection />
      case 'about':
        return <AboutSection />
      case 'advanced':
        return <AdvancedSection />
      case 'rules':
        return <RulesSection />
    }
  }

  return (
    <div className="flex h-full overflow-hidden">
      {/* 左侧子菜单 */}
      <nav className="w-44 shrink-0 space-y-1 border-r border-cyber-border p-3">
        <div className="mb-2 px-2 text-[10px] font-medium uppercase tracking-wider text-cyber-faint">设置</div>
        {SECTIONS.map((s) => {
          const Icon = s.icon
          const active = section === s.key
          return (
            <button
              key={s.key}
              onClick={() => setSection(s.key)}
              className={cn(
                'flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition-all',
                active ? 'nav-item-active' : 'text-cyber-dim hover:bg-white/5 hover:text-cyber-text'
              )}
            >
              <Icon className="h-4 w-4" />
              {s.name}
            </button>
          )
        })}
      </nav>

      {/* 右侧内容 */}
      <div className="min-w-0 flex-1 overflow-y-auto p-6">{renderSection()}</div>
    </div>
  )
}
