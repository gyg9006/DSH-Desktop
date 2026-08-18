import { useCallback, useEffect, useRef, useState } from 'react'
import type { JSX } from 'react'
import { Moon, Sun, Monitor, Palette, ImagePlus, Trash2 } from 'lucide-react'
import type { ActiveThemePayload, SessionBackgroundPayload, ThemeInfoPayload, ThemeMode } from '@shared/ipc'
import { useTheme } from '../../../hooks/useTheme'
import { applyClientTheme } from '../../../lib/theme'
import { GRADIENT_PRESETS, backgroundStyle } from '../../../lib/sessionBackground'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../ui/card'
import { Button } from '../../ui/button'
import { Badge } from '../../ui/badge'
import { useToast } from '../../ui/toast'
import { cn } from '../../../lib/utils'

const THEMES: Array<{ key: ThemeMode; name: string; icon: typeof Moon; desc: string }> = [
  { key: 'dark', name: '深色', icon: Moon, desc: '暗色基调' },
  { key: 'light', name: '浅色', icon: Sun, desc: '明亮模式' },
  { key: 'system', name: '跟随系统', icon: Monitor, desc: '随 Windows 自动切换' }
]

/** 外观设置：客户端主题（全局换肤）+ 会话背景 + dsh 明暗偏好。 */
export function AppearanceSection(): JSX.Element {
  const { theme, setTheme } = useTheme()
  const [themeList, setThemeList] = useState<ThemeInfoPayload[]>([])
  const [activeTheme, setActiveTheme] = useState<ActiveThemePayload | null>(null)

  useEffect(() => {
    void window.dshw.themeList().then(setThemeList).catch(() => undefined)
    void window.dshw.themeGet().then(setActiveTheme).catch(() => undefined)
  }, [])

  const switchTheme = async (id: string): Promise<void> => {
    const r = await window.dshw.themeSet(id)
    if (r.ok && r.theme) {
      setActiveTheme(r.theme)
      applyClientTheme(r.theme)
    }
  }

  return (
    <div className="max-w-3xl space-y-4">
      {/* 客户端主题（全局换肤） */}
      <Card className="glow-border border-cyber-neon/30">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Palette className="h-4 w-4 text-cyber-neon" /> 客户端主题
          </CardTitle>
          <CardDescription>
            主题插件（type=theme, scope=application）作用于整个客户端：标题栏、侧边栏、工作台、弹窗、设置页、托盘图标等全部 UI。
            将主题插件放入工作文件夹 themes/ 目录后，重启即可在此选择。
          </CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {themeList.map((t) => (
            <button
              key={t.id}
              onClick={() => void switchTheme(t.id)}
              className={cn(
                'flex flex-col items-start gap-1.5 rounded-xl border p-3 text-left transition-all',
                activeTheme?.id === t.id ? 'glow-border border-cyber-neon/60 bg-cyber-neon/10' : 'border-cyber-border bg-cyber-panel hover:border-cyber-neon/40'
              )}
            >
              <span className="flex w-full items-center justify-between">
                <span className="text-sm font-medium text-cyber-text">{t.name}</span>
                {t.isDefault && <Badge variant="outline" className="px-1.5 text-[9px]">内置</Badge>}
                {!t.isDefault && t.hasPreview && <Badge variant="violet" className="px-1.5 text-[9px]">有预览</Badge>}
              </span>
              <span className="text-[10px] text-cyber-dim">
                v{t.version}
                {t.author ? ` · ${t.author}` : ''}
                {t.darkMode ? ' · 暗色' : ' · 亮色'}
              </span>
            </button>
          ))}
        </CardContent>
      </Card>

      <SessionBackgroundCard />

      {/* dsh 明暗偏好 */}
      <Card>
        <CardHeader>
          <CardTitle>明暗偏好</CardTitle>
          <CardDescription>深色 / 浅色 / 跟随系统，与 dsh 界面同步。</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-3 gap-3">
          {THEMES.map((t) => {
            const Icon = t.icon
            const active = theme === t.key
            return (
              <button
                key={t.key}
                onClick={() => void setTheme(t.key)}
                className={cn(
                  'flex flex-col items-center gap-2 rounded-xl border p-4 transition-all',
                  active ? 'glow-border border-cyber-neon/60 bg-cyber-neon/10' : 'border-cyber-border bg-cyber-panel hover:border-cyber-neon/40'
                )}
              >
                <Icon className={cn('h-6 w-6', active ? 'text-cyber-neon' : 'text-cyber-dim')} />
                <span className="text-sm font-medium text-cyber-text">{t.name}</span>
                <span className="text-center text-[10px] leading-relaxed text-cyber-dim">{t.desc}</span>
              </button>
            )
          })}
        </CardContent>
        <CardContent className="pt-0">
          <Button size="sm" variant="outline" onClick={() => void window.dshw.openSettingsFile()}>
            打开 dsh 设置文件
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}

const IMAGE_FILTERS = [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'svg', 'gif'] }]

/** 会话背景：预设（跟随主题/纯色/渐变）+ 自定义图片（Canvas 压缩 ≤2K）+ 调整项 + 实时预览。 */
function SessionBackgroundCard(): JSX.Element {
  const { toast } = useToast()
  const [cfg, setCfg] = useState<SessionBackgroundPayload | null>(null)
  const [imageDataUrl, setImageDataUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const savedRef = useRef(false)

  useEffect(() => {
    void (async () => {
      try {
        const config = await window.dshw.getConfig()
        const bg = (config.sessionBackground ?? null) as SessionBackgroundPayload | null
        setCfg(bg)
        if (bg?.type === 'image' && bg.imagePath) {
          const info = await window.dshw.getWorkspaceInfo()
          const read = await window.dshw.readFileAsDataUrl(`${info.workspacePath.replace(/\\/g, '/')}/${bg.imagePath}`)
          if (read.ok && read.dataUrl) setImageDataUrl(read.dataUrl)
        }
      } catch {
        /* 忽略加载失败 */
      }
    })()
  }, [])

  const save = useCallback(
    async (next: SessionBackgroundPayload | null): Promise<void> => {
      setCfg(next)
      savedRef.current = true
      const result = await window.dshw.updateConfig({ sessionBackground: next ?? undefined })
      if (!result.ok) toast(result.error ?? '保存失败', 'error')
      else toast('会话背景已保存（切换回核心工作台即可看到效果）', 'success')
    },
    [toast]
  )

  /** 上传图片：读取 → Canvas 压缩至 ≤2048 → 存工作文件夹 → 应用。 */
  const uploadImage = useCallback(async (): Promise<void> => {
    const chosen = await window.dshw.chooseFile('选择会话背景图片', IMAGE_FILTERS)
    if (!chosen.ok || chosen.canceled || !chosen.path) return
    setBusy(true)
    try {
      const read = await window.dshw.readFileAsDataUrl(chosen.path)
      if (!read.ok || !read.dataUrl) {
        toast(read.error ?? '读取图片失败', 'error')
        return
      }
      // SVG 原样引用；位图走 Canvas 压缩
      const isSvg = /^data:image\/svg/.test(read.dataUrl)
      let finalDataUrl = read.dataUrl
      let ext = 'svg'
      if (!isSvg) {
        const img = new Image()
        img.src = read.dataUrl
        await img.decode()
        const maxSide = 2048
        const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight))
        const canvas = document.createElement('canvas')
        canvas.width = Math.max(1, Math.round(img.naturalWidth * scale))
        canvas.height = Math.max(1, Math.round(img.naturalHeight * scale))
        const ctx = canvas.getContext('2d')
        if (!ctx) throw new Error('Canvas 不可用')
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
        finalDataUrl = canvas.toDataURL('image/webp', 0.85)
        ext = 'webp'
      }
      const name = `session-bg-${Date.now()}.${ext}`
      const saved = await window.dshw.saveSessionBackground(finalDataUrl, name)
      if (!saved.ok || !saved.relPath) {
        toast(saved.error ?? '保存图片失败', 'error')
        return
      }
      setImageDataUrl(finalDataUrl)
      await save({ type: 'image', imagePath: saved.relPath, fit: 'cover', opacity: 1, blur: 0 })
    } catch (error) {
      toast(`图片处理失败：${String(error)}`, 'error')
    } finally {
      setBusy(false)
    }
  }, [save, toast])

  const previewStyle = backgroundStyle(cfg ?? undefined, cfg?.type === 'image' ? imageDataUrl : undefined)

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ImagePlus className="h-4 w-4 text-cyber-neon" /> 会话背景
        </CardTitle>
        <CardDescription>仅作用于核心工作台对话区域（不影响侧边栏/标题栏）；图片自动压缩至 ≤2K。</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* 实时预览 */}
        <div
          className={cn('h-24 w-full rounded-lg border border-cyber-border transition-all', !previewStyle.backgroundImage && 'bg-cyber-panel2')}
          style={previewStyle}
        >
          <div className="flex h-full items-center justify-center text-[10px] text-cyber-dim">
            {cfg?.type === 'image' ? '对话区域预览' : cfg ? '对话区域预览' : '跟随主题（默认）'}
          </div>
        </div>

        {/* 预设 */}
        <div className="space-y-2">
          <div className="text-[11px] font-medium text-cyber-text">预设</div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant={!cfg || cfg.type === 'theme' ? 'default' : 'outline'}
              className="h-6 px-2 text-[10px]"
              onClick={() => void save(null)}
            >
              跟随主题
            </Button>
            <input
              type="color"
              value={(cfg?.type === 'color' ? cfg.color : '#14141a') ?? '#14141a'}
              onChange={(e) => void save({ type: 'color', color: e.target.value, fit: 'cover', opacity: 1, blur: 0 })}
              className="h-6 w-8 cursor-pointer rounded border border-cyber-border bg-transparent"
              title="纯色"
            />
            {GRADIENT_PRESETS.map((g) => (
              <button
                key={g.name}
                title={g.name}
                onClick={() => void save({ type: 'gradient', gradient: g.colors, fit: 'cover', opacity: 1, blur: 0 })}
                className={cn(
                  'h-6 w-10 rounded-md border transition-all',
                  cfg?.type === 'gradient' && JSON.stringify(cfg.gradient) === JSON.stringify(g.colors)
                    ? 'border-cyber-neon ring-1 ring-cyber-neon/50'
                    : 'border-cyber-border'
                )}
                style={{ background: `linear-gradient(135deg, ${g.colors.join(', ')})` }}
              />
            ))}
            <Button size="sm" variant="outline" className="h-6 px-2 text-[10px]" onClick={() => void uploadImage()} disabled={busy}>
              <ImagePlus className="h-3 w-3" /> 上传图片
            </Button>
            {cfg?.type === 'image' && (
              <Button
                size="sm"
                variant="ghost"
                className="h-6 px-2 text-[10px] text-cyber-red"
                onClick={() => void save(null)}
              >
                <Trash2 className="h-3 w-3" /> 清除图片
              </Button>
            )}
          </div>
        </div>

        {/* 调整项 */}
        {cfg && cfg.type !== 'theme' && (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <label className="flex flex-col gap-1 text-[10px] text-cyber-dim">
              填充模式
              <select
                value={cfg.fit ?? 'cover'}
                onChange={(e) => void save({ ...cfg, fit: e.target.value as 'cover' | 'contain' | 'fill' })}
                className="h-7 rounded-md border border-cyber-border bg-cyber-panel2 px-2 text-[11px] text-cyber-text focus:outline-none"
              >
                <option value="cover">cover（铺满裁切）</option>
                <option value="contain">contain（完整显示）</option>
                <option value="fill">fill（拉伸铺满）</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 text-[10px] text-cyber-dim">
              透明度 {cfg.opacity !== undefined ? Math.round(cfg.opacity * 100) : 100}%
              <input
                type="range"
                min={10}
                max={100}
                value={Math.round((cfg.opacity ?? 1) * 100)}
                onChange={(e) => void save({ ...cfg, opacity: Number(e.target.value) / 100 })}
                className="accent-cyber-neon"
              />
            </label>
            <label className="flex flex-col gap-1 text-[10px] text-cyber-dim">
              模糊 {cfg.blur ?? 0}px
              <input
                type="range"
                min={0}
                max={20}
                value={cfg.blur ?? 0}
                onChange={(e) => void save({ ...cfg, blur: Number(e.target.value) })}
                className="accent-cyber-neon"
              />
            </label>
          </div>
        )}
        {savedRef.current && (
          <p className="text-[11px] leading-relaxed text-cyber-faint">已保存；切换回「核心工作台」视图查看实际效果。</p>
        )}
      </CardContent>
    </Card>
  )
}
