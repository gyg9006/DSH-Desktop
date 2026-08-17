import { useState } from 'react'
import type { JSX } from 'react'
import { TitleBar } from './components/layout/TitleBar'
import { Sidebar, type ViewKey } from './components/layout/Sidebar'
import { Footer } from './components/layout/Footer'
import { Home } from './components/views/Home'
import { DSHCore } from './components/views/DSHCore'
import { SessionMgr } from './components/views/SessionMgr'
import { AgentMgr } from './components/views/AgentMgr'
import { KnowledgeBase } from './components/views/KnowledgeBase'
import { SkillMgr } from './components/views/SkillMgr'
import { Settings } from './components/views/Settings'
import { useTheme } from './hooks/useTheme'

/**
 * DSH Desktop v2.0 应用外壳：
 * 自定义标题栏 + 左侧导航（6 模块）+ 主内容区 + 底部状态栏。
 */
export default function App(): JSX.Element {
  const [view, setView] = useState<ViewKey>('workbench')
  useTheme() // 应用持久化主题（dark class）

  const renderView = (): JSX.Element => {
    switch (view) {
      case 'workbench':
        return <DSHCore />
      case 'sessions':
        return <SessionMgr />
      case 'agents':
        return <AgentMgr />
      case 'knowledge':
        return <KnowledgeBase />
      case 'skills':
        return <SkillMgr />
      case 'settings':
        return <Settings />
      default:
        return <Home />
    }
  }

  return (
    <div className="flex h-full flex-col bg-cyber-bg text-cyber-text">
      <TitleBar />
      <div className="flex min-h-0 flex-1">
        <Sidebar active={view} onSelect={setView} />
        <main className="min-w-0 flex-1 overflow-hidden">{renderView()}</main>
      </div>
      <Footer />
    </div>
  )
}
