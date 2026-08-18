import { useEffect, useRef } from 'react'

import type { JSX } from 'react'
import { Zap, FolderSync, ShieldCheck } from 'lucide-react'
import { useAppInfo } from '../../lib/appInfo'

interface Particle {
  x: number
  y: number
  vx: number
  vy: number
  r: number
  hue: number
}

/** Canvas 粒子网络动画（零依赖，随窗口尺寸自适应）。 */
function ParticleField(): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let raf = 0
    let particles: Particle[] = []
    let width = 0
    let height = 0

    const init = (): void => {
      width = canvas.width = canvas.offsetWidth
      height = canvas.height = canvas.offsetHeight
      const count = Math.min(90, Math.floor((width * height) / 18000))
      particles = Array.from({ length: count }, () => ({
        x: Math.random() * width,
        y: Math.random() * height,
        vx: (Math.random() - 0.5) * 0.5,
        vy: (Math.random() - 0.5) * 0.5,
        r: Math.random() * 1.6 + 0.6,
        hue: Math.random() < 0.6 ? 187 : 262 // 青 / 紫
      }))
    }

    const step = (): void => {
      ctx.clearRect(0, 0, width, height)
      for (const p of particles) {
        p.x += p.vx
        p.y += p.vy
        if (p.x < 0 || p.x > width) p.vx *= -1
        if (p.y < 0 || p.y > height) p.vy *= -1
        ctx.beginPath()
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2)
        ctx.fillStyle = `hsla(${p.hue}, 90%, 65%, 0.7)`
        ctx.fill()
      }
      // 连线
      for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
          const a = particles[i]
          const b = particles[j]
          const dx = a.x - b.x
          const dy = a.y - b.y
          const dist = Math.hypot(dx, dy)
          if (dist < 130) {
            ctx.beginPath()
            ctx.moveTo(a.x, a.y)
            ctx.lineTo(b.x, b.y)
            ctx.strokeStyle = `hsla(187, 90%, 60%, ${0.14 * (1 - dist / 130)})`
            ctx.lineWidth = 0.6
            ctx.stroke()
          }
        }
      }
      raf = requestAnimationFrame(step)
    }

    init()
    step()
    const onResize = (): void => init()
    window.addEventListener('resize', onResize)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', onResize)
    }
  }, [])

  return <canvas id="particles-canvas" ref={canvasRef} />
}

const FEATURES = [
  { icon: Zap, title: '开箱即聊', desc: '真实 DeepSeek Harness，一键启动服务' },
  { icon: FolderSync, title: '拷贝即迁移', desc: '一个文件夹装下全部环境与数据' },
  { icon: ShieldCheck, title: '零残留', desc: '不写注册表、不污染 %APPDATA%' }
]

export function Home(): JSX.Element {
  const info = useAppInfo()
  const version = info?.appVersion ?? '2.0.0'

  return (
    <div className="scan-line relative flex h-full flex-col items-center justify-center overflow-hidden bg-cyber-grid bg-[length:36px_36px] bg-cyber-glow">
      <ParticleField />

      <div className="relative z-10 flex flex-col items-center animate-fade-in">
        {/* Logo 徽章 */}
        <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-2xl border border-cyber-neon/40 bg-cyber-neon/10 shadow-glow-neon">
          <span className="text-4xl font-black neon-text">D</span>
        </div>

        <h1 className="text-5xl font-black tracking-[0.3em] text-cyber-text">
          DSH <span className="neon-text">DESKTOP</span>
        </h1>
        <p className="mt-3 text-sm tracking-widest text-cyber-dim">
          DeepSeek Harness 便携式桌面客户端
        </p>

        <div className="mt-4 flex items-center gap-2">
          <span className="rounded-md border border-cyber-violet/40 bg-cyber-violet/10 px-3 py-1 font-mono text-sm neon-text-violet">
            v{version}
          </span>
          <span className="rounded-md border border-cyber-border bg-cyber-panel2 px-3 py-1 text-xs text-cyber-faint">
            左侧导航选择功能模块
          </span>
        </div>

        {/* 卖点 */}
        <div className="mt-10 flex gap-6">
          {FEATURES.map((f) => {
            const Icon = f.icon
            return (
              <div key={f.title} className="glass-panel flex w-44 flex-col items-center gap-2 px-4 py-5 text-center">
                <Icon className="h-6 w-6 text-cyber-neon drop-shadow-[0_0_6px_rgba(0,229,255,0.7)]" />
                <div className="text-sm font-semibold text-cyber-text">{f.title}</div>
                <div className="text-[11px] leading-relaxed text-cyber-dim">{f.desc}</div>
              </div>
            )
          })}
        </div>
      </div>

      {/* 底部流动光条 */}
      <div className="absolute bottom-0 left-0 right-0 h-px flow-line" />
    </div>
  )
}
