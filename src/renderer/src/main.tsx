import React, { useEffect, useState } from 'react'
import type { JSX } from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles/index.css'

/**
 * 渲染进程错误边界：任何组件渲染异常都显示兜底页（重新加载按钮），
 * 而不是白屏；异常同时上报主进程日志。
 */
class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null }

  static getDerivedStateFromError(error: Error): { error: Error } {
    return { error }
  }

  componentDidCatch(error: Error): void {
    try {
      void window.dshw?.reportLog?.('error', `渲染层异常：${error?.stack ?? String(error)}`).catch(() => undefined)
    } catch {
      /* 上报失败不阻断 */
    }
  }

  render(): React.ReactNode {
    if (this.state.error) {
      return (
        <div
          style={{
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 12,
            background: '#0b0f1a',
            color: '#cbd5e1',
            fontFamily: 'Segoe UI, Microsoft YaHei, sans-serif'
          }}
        >
          <div style={{ fontSize: 15, fontWeight: 600, color: '#00e5ff' }}>界面加载出错</div>
          <div style={{ maxWidth: 480, fontSize: 12, color: '#8a94a6', textAlign: 'center', wordBreak: 'break-all' }}>
            {String(this.state.error?.message ?? this.state.error)}
          </div>
          <button
            onClick={() => window.location.reload()}
            style={{
              marginTop: 4,
              padding: '6px 16px',
              borderRadius: 8,
              border: '1px solid rgba(0,229,255,.5)',
              background: 'rgba(0,229,255,.12)',
              color: '#00e5ff',
              cursor: 'pointer',
              fontSize: 13
            }}
          >
            重新加载
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

/**
 * 启动引导：先读取工作文件夹配置（onboarded 判定），
 * 数据就绪前渲染极简加载壳（避免白屏闪烁）；就绪后挂载主应用。
 */
function Boot(): JSX.Element {
  const [ready, setReady] = useState(false)
  const [onboarded, setOnboarded] = useState(false)
  const [appVersion, setAppVersion] = useState('0.0.0')

  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const [config, info] = await Promise.all([window.dshw.getConfig(), window.dshw.getAppInfo()])
        const currentVersion = info.appVersion || '0.0.0'
        document.title = `DSH-Desktop v${currentVersion}`
        if (alive) {
          setAppVersion(currentVersion)
          // 引导完成标记（onboarded）一旦写入即永久跳过引导，升级版本也不重新弹出
          // （不再要求 onboardingVersion 匹配当前版本；该字段缺失会导致引导页每次启动都出现）。
          setOnboarded(config?.onboarded === true)
        }
      } catch {
        if (alive) {
          setOnboarded(false)
          setAppVersion('0.0.0')
        }
      } finally {
        if (alive) setReady(true)
      }
    })()
    return () => {
      alive = false
    }
  }, [])

  if (!ready) {
    return (
      <div
        style={{
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#0b0f1a',
          color: '#00e5ff',
          fontSize: 13,
          fontFamily: 'Segoe UI, Microsoft YaHei, sans-serif'
        }}
      >
        DSH 桌面 启动中…
      </div>
    )
  }

  return (
    <ErrorBoundary>
      <App initialOnboarded={onboarded} appVersion={appVersion} onOnboarded={() => setOnboarded(true)} />
    </ErrorBoundary>
  )
}

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <Boot />
  </React.StrictMode>
)
