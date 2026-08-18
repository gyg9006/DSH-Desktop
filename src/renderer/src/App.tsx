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
import { OnboardingWizard } from './components/views/OnboardingWizard'
import { UpdateCenter } from './components/update/UpdateCenter'
import { ToastProvider } from './components/ui/toast'
import { useTheme } from './hooks/useTheme'

interface AppProps {
  /** 首次启动引导是否已完成（读取自 workspace/config/app.json 的 onboarded）。 */
  initialOnboarded: boolean
  /** 引导完成回调（父级刷新 onboarded 状态）。 */
  onOnboarded: () => void
}

/** 独立路由入口：#/onboarding 可强制直达引导页（与主应用解耦）。 */
function isOnboardingRoute(): boolean {
  return typeof window !== 'undefined' && window.location.hash.startsWith('#/onboarding')
}

/**
 * DSH Desktop v2.0 应用外壳：
 * 入口守卫（onboarded !== true → 渲染独立三步引导，不依赖服务/配置）；
 * 自定义标题栏 + 左侧导航（6 模块）+ 主内容区 + 底部状态栏。
 */
export default function App({ initialOnboarded, onOnboarded }: AppProps): JSX.Element {
  const [onboarded, setOnboarded] = useState<boolean>(initialOnboarded)
  const [view, setView] = useState<ViewKey>('workbench')
  useTheme() // 应用持久化主题（dark class），引导页同样生效

  if (!onboarded || isOnboardingRoute()) {
    return (
      <ToastProvider>
        <OnboardingWizard
          onComplete={() => {
            onOnboarded()
            setOnboarded(true)
            if (window.location.hash.startsWith('#/onboarding')) window.location.hash = ''
          }}
        />
      </ToastProvider>
    )
  }

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
    <ToastProvider>
      <div className="flex h-full flex-col bg-cyber-bg text-cyber-text">
        <TitleBar />
        <div className="flex min-h-0 flex-1">
          <Sidebar active={view} onSelect={setView} />
          <main className="min-w-0 flex-1 overflow-hidden">{renderView()}</main>
        </div>
        <Footer />
      </div>
      {/* 版本更新通知中心（发现新版本 → 非阻断 Toast + 进度窗口） */}
      <UpdateCenter />
    </ToastProvider>
  )
}
