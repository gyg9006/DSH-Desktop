import { useEffect, useState } from 'react'

import type { JSX } from 'react'
import { Settings as SettingsIcon, Palette, Keyboard, Info, Cpu, Monitor } from 'lucide-react'
import type { AppInfo } from '@shared/ipc'
import { cn } from '../../lib/utils'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card'
import { Badge } from '../ui/badge'

type SettingSection = 'general' | 'appearance' | 'shortcuts' | 'about' | 'advanced'

const SECTIONS: Array<{ key: SettingSection; name: string; icon: typeof SettingsIcon }> = [
  { key: 'general', name: '通用', icon: SettingsIcon },
  { key: 'appearance', name: '外观', icon: Palette },
  { key: 'shortcuts', name: '快捷键', icon: Keyboard },
  { key: 'about', name: '关于', icon: Info },
  { key: 'advanced', name: '高级配置', icon: Cpu }
]

/**
 * 模块6：设置 —— 左侧子菜单 + 右侧表单。
 * 本轮落地：关于（真实版本信息）；通用/外观/快捷键/高级为占位外壳（后续轮次接入 v0.3 设置项）。
 */
export function Settings(): JSX.Element {
  const [section, setSection] = useState<SettingSection>('general')

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
      <div className="min-w-0 flex-1 overflow-y-auto p-6">
        {section === 'about' && <AboutSection />}
        {section !== 'about' && (
          <Card className="max-w-2xl">
            <CardHeader>
              <CardTitle>{SECTIONS.find((s) => s.key === section)?.name}</CardTitle>
              <CardDescription>该设置项将在后续版本接入完整表单（迁移自 v0.3 设置面板）。</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex h-40 items-center justify-center text-cyber-faint">
                <Monitor className="mr-2 h-5 w-5" /> 敬请期待
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}

function AboutSection(): JSX.Element {
  const [info, setInfo] = useState<AppInfo | null>(null)
  const [dshVersion, setDshVersion] = useState('检测中…')
  const [nodeVersion, setNodeVersion] = useState('检测中…')

  useEffect(() => {
    void window.dshw.getAppInfo().then(setInfo).catch(() => undefined)
    void window.dshw
      .detectEnv()
      .then((payload) => {
        setDshVersion(payload.items.find((i) => i.key === 'dsh')?.version ?? '未安装')
        setNodeVersion(payload.items.find((i) => i.key === 'node')?.version ?? '未检测')
      })
      .catch(() => undefined)
  }, [])

  const rows: Array<[string, string]> = [
    ['客户端版本', `v${info?.appVersion ?? '2.0.0'}`],
    ['DeepSeek Harness（dsh）', dshVersion],
    ['Node.js', nodeVersion],
    ['Electron', info?.electron ?? '—'],
    ['Chromium', info?.chrome ?? '—']
  ]

  return (
    <div className="max-w-2xl space-y-4">
      <Card className="glow-border border-cyber-neon/30">
        <CardHeader>
          <div className="flex items-center gap-3">
            <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-cyber-neon to-cyber-violet text-lg font-black text-cyber-bg shadow-glow-neon">
              D
            </span>
            <div>
              <CardTitle className="text-lg">DSH 桌面 v2.0</CardTitle>
              <CardDescription>DeepSeek Harness 便携式 Windows 桌面客户端（React · 赛博朋克 UI）</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
          {rows.map(([label, value]) => (
            <div key={label} className="flex items-center justify-between rounded-lg border border-cyber-border bg-cyber-panel2 px-3 py-2 text-xs">
              <span className="text-cyber-dim">{label}</span>
              <span className="font-medium text-cyber-text">{value}</span>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>更新方式</CardTitle>
          <CardDescription>自动更新：应用启动后与每 6 小时检测 GitHub Releases 新版本，下载完成后提示重启应用。</CardDescription>
        </CardHeader>
        <CardContent>
          <Badge variant="default">自动更新已开启</Badge>
        </CardContent>
      </Card>

      <p className="text-[11px] leading-relaxed text-cyber-faint">
        开源许可：本应用（MIT）与 DeepSeek Harness（MIT）均基于 MIT 协议开源；数据与配置全部保存在工作文件夹内，可随时整文件夹迁移。
      </p>
    </div>
  )
}
