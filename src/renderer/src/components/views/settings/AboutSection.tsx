import { useEffect, useState } from 'react'
import type { JSX } from 'react'
import type { AppInfo } from '@shared/ipc'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../ui/card'
import { Badge } from '../../ui/badge'

/** 关于：客户端 / dsh / Node / Git / Electron 版本 + 更新方式。 */
export function AboutSection(): JSX.Element {
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
