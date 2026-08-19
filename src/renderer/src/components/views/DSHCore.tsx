import { useCallback, useEffect, useRef, useState } from 'react'
import type { JSX } from 'react'
import { RefreshCw, FolderOpen, FileUp, BrainCircuit, Loader2, Sparkles, FileText, Code2, ScanSearch, GitMerge, Archive, CheckCircle2, XCircle } from 'lucide-react'
import { useDshService } from '../../hooks/useDshService'
import { Button } from '../ui/button'
import { Badge } from '../ui/badge'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../ui/dialog'
import { Input } from '../ui/input'
import { Textarea } from '../ui/textarea'
import { Progress } from '../ui/progress'
import { useToast } from '../ui/toast'
import { backgroundStyle } from '../../lib/sessionBackground'
import type { SessionBackgroundPayload } from '@shared/ipc'
import type { ExtractStepKey, KnowledgeCategory } from '@shared/ipc'

/**
 * 模块1：DSH 核心工作台。
 * - 嵌入完整 DSH Web 界面（webview），保留全部功能；
 * - 会话导入（文件夹 / 文件）；
 * - 「提炼会话」：一键智能提炼流水线（SkillOrchestrator 六步编排，进度实时展示）。
 *
 * API Key 引导屏蔽：dsh 的 API Key / onboarding 弹窗由客户端「设置 → 模型与 API」统一管理，
 * 这里在 dsh 界面加载后注入 JS 隐藏引导类弹窗/遮罩（兜底；主路径是 settings.yaml 已写入
 * llm-deepseek 预设模型，dsh 不再进入「未配置」引导态）。
 */
const HIDE_DSH_ONBOARDING_JS = `(() => {
  // 只处理明确的 onboarding/API Key 引导，绝不隐藏普通 dialog、modal、setup 或会话层，
  // 避免更新后 DSH 对话区出现毛玻璃/遮罩残留和点击无响应。
  const hide = () => {
    const candidates = [
      ...document.querySelectorAll('[data-onboarding], [data-testid*="onboarding"], [class*="onboarding"], [class*="Onboarding"]')
    ]
    for (const el of candidates) {
      const e = el
      if (e && e.style) { e.style.display = 'none'; e.style.visibility = 'hidden'; e.removeAttribute('inert') }
    }
    for (const el of document.querySelectorAll('[role="dialog"]')) {
      const text = (el.textContent || '').slice(0, 1200)
      if (/api\\s*key|api\\s*密钥|配置.*密钥|onboarding|getting started|welcome to/i.test(text)) {
        const e = el
        if (e.style) { e.style.display = 'none'; e.style.visibility = 'hidden' }
      }
    }
    const root = document.getElementById('root') || document.body
    if (root && root.hasAttribute('inert')) root.removeAttribute('inert')
  }
  hide()
  let runs = 0
  try {
    const mo = new MutationObserver(() => { if (++runs < 80) hide(); else mo.disconnect() })
    mo.observe(document.body, { childList: true, subtree: true })
    setTimeout(() => mo.disconnect(), 10000)
  } catch { /* 忽略 */ }
  setTimeout(hide, 1000)
  setTimeout(hide, 3000)
})()`

export function DSHCore(): JSX.Element {
  const service = useDshService()
  const webviewRef = useRef<Electron.WebviewTag | null>(null)
  // dsh 界面加载完成后注入引导屏蔽 JS（API Key/onboarding 弹窗由客户端设置统一管理）
  const injectHideOnboarding = useCallback((): void => {
    webviewRef.current?.executeJavaScript(HIDE_DSH_ONBOARDING_JS).catch(() => undefined)
  }, [])
  const [dshUrl, setDshUrl] = useState('')
  const [webviewReady, setWebviewReady] = useState(false)
  const [webviewTimedOut, setWebviewTimedOut] = useState(false)
  const running = service.status === 'running'
  // 会话背景（需求五）：仅对话区域容器
  const [bgStyle, setBgStyle] = useState<React.CSSProperties>({})

  useEffect(() => {
    if (running && service.port) {
      setDshUrl(`http://localhost:${service.port}/`)
      setWebviewReady(false)
      setWebviewTimedOut(false)
      const timer = window.setTimeout(() => setWebviewTimedOut(true), 10000)
      return () => window.clearTimeout(timer)
    }
    setDshUrl('')
    setWebviewReady(false)
    setWebviewTimedOut(false)
    return undefined
  }, [running, service.port])

  const onWebviewReady = useCallback((): void => {
    setWebviewReady(true)
    setWebviewTimedOut(false)
    injectHideOnboarding()
  }, [injectHideOnboarding])

  useEffect(() => {
    void (async () => {
      try {
        const config = await window.dshw.getConfig()
        const bg = (config.sessionBackground ?? null) as SessionBackgroundPayload | null
        if (!bg || bg.type === 'theme') {
          setBgStyle({})
          return
        }
        let imageDataUrl = ''
        if (bg.type === 'image' && bg.imagePath) {
          const info = await window.dshw.getWorkspaceInfo()
          const read = await window.dshw.readFileAsDataUrl(`${info.workspacePath.replace(/\\/g, '/')}/${bg.imagePath}`)
          if (read.ok && read.dataUrl) imageDataUrl = read.dataUrl
        }
        setBgStyle(backgroundStyle(bg, imageDataUrl))
      } catch {
        /* 忽略背景加载失败 */
      }
    })()
  }, [])

  const onImport = useCallback(async (mode: 'folder' | 'file'): Promise<void> => {
    const result = await window.dshw.importSessions(mode)
    if (result.ok && result.count > 0) {
      alert(`成功导入 ${result.count} 个会话`)
    } else if (!result.canceled) {
      alert(result.error ?? '没有导入任何会话')
    }
  }, [])

  return (
    <div className="flex h-full flex-col">
      {/* 工具栏 */}
      <div className="flex items-center gap-2 border-b border-cyber-border px-3 py-2">
        <span className="text-sm font-semibold text-cyber-text">核心工作台</span>
        {running && dshUrl && (
          <Badge variant="green" className="ml-1">
            dsh 已连接
          </Badge>
        )}
        <div className="flex-1" />
        <Button size="sm" variant="ghost" onClick={() => void onImport('folder')} disabled={!running}>
          <FolderOpen className="h-3.5 w-3.5" /> 导入文件夹
        </Button>
        <Button size="sm" variant="ghost" onClick={() => void onImport('file')} disabled={!running}>
          <FileUp className="h-3.5 w-3.5" /> 导入文件
        </Button>
        <Button size="sm" variant="outline" onClick={() => webviewRef.current?.reload()} disabled={!running}>
          <RefreshCw className="h-3.5 w-3.5" /> 刷新
        </Button>
        <ExtractSessionDialog />
      </div>

      {/* webview / 空态（会话背景作用于此对话区域） */}
      <div className="relative min-h-0 flex-1" style={bgStyle}>
        {running && dshUrl ? (
          <webview
            ref={(el) => {
              const wv = (el as Electron.WebviewTag | null) ?? null
              webviewRef.current = wv
              if (wv) {
                wv.removeEventListener('did-finish-load', onWebviewReady)
                wv.addEventListener('did-finish-load', onWebviewReady)
              }
            }}
            src={dshUrl}
            className="h-full w-full"
            style={{ display: 'flex' }}
            partition="persist:dshv2"
          />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-3">
            <div className="text-3xl">🛰️</div>
            <div className="text-sm text-cyber-text">服务未启动</div>
            <p className="max-w-sm text-center text-xs leading-relaxed text-cyber-dim">
              dsh 服务停止时无法加载对话界面。点击底部状态栏「启动服务」，启动后自动加载 DSH Web 工作台。
            </p>
            <Button
              size="sm"
              variant="default"
              disabled={service.busy}
              onClick={() => void service.start()}
            >
              {service.busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              启动服务
            </Button>
          </div>
        )}
        {running && dshUrl && !webviewReady && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-cyber-bg/95">
            <div className="flex flex-col items-center gap-3 text-center">
              {webviewTimedOut ? (
                <>
                  <div className="text-sm text-cyber-red">服务启动超时，请重试</div>
                  <Button size="sm" variant="outline" onClick={() => webviewRef.current?.reload()}>
                    <RefreshCw className="h-3.5 w-3.5" /> 重启会话界面
                  </Button>
                </>
              ) : (
                <>
                  <Loader2 className="h-5 w-5 animate-spin text-cyber-neon" />
                  <div className="text-xs text-cyber-dim">正在加载 DSH 会话界面…</div>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

const STEPS: Array<{ key: ExtractStepKey; name: string; icon: typeof FileText; desc: string }> = [
  { key: 'distill', name: '预处理与蒸馏', icon: BrainCircuit, desc: 'session-distiller · 提取问题/方案/代码/标签' },
  { key: 'extract', name: '代码萃取增强', icon: Code2, desc: 'code-snippet-extractor · 语言标记与注释' },
  { key: 'vector', name: '语义向量化', icon: ScanSearch, desc: 'vector-embedder · 生成检索向量' },
  { key: 'refine', name: '知识去重合并', icon: GitMerge, desc: 'knowledge-refiner · 相似度>0.85 增量合并' },
  { key: 'archive', name: '归档与索引', icon: Archive, desc: 'markdown-archiver · 知识卡片 + 索引' }
]

type StepState = 'pending' | 'running' | 'done' | 'error'

/** 「提炼会话」：一键智能提炼流水线对话框。 */
function ExtractSessionDialog(): JSX.Element {
  const { toast } = useToast()
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [sessionTitle, setSessionTitle] = useState('')
  const [categories, setCategories] = useState<KnowledgeCategory[]>([])
  const [categoryId, setCategoryId] = useState('')
  const [busy, setBusy] = useState(false)
  const [needCategory, setNeedCategory] = useState(false)
  const [newCategory, setNewCategory] = useState('')
  const [percent, setPercent] = useState(0)
  const [stepStates, setStepStates] = useState<Record<ExtractStepKey, StepState>>({
    distill: 'pending',
    extract: 'pending',
    vector: 'pending',
    refine: 'pending',
    archive: 'pending'
  })
  const [currentStep, setCurrentStep] = useState<ExtractStepKey | null>(null)
  const [resultMsg, setResultMsg] = useState('')
  const [loadingRecent, setLoadingRecent] = useState(false)

  useEffect(() => {
    if (open) {
      void window.dshw.knowledgeGet().then((p) => setCategories(p.categories))
      void loadRecent()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // 订阅流水线进度（组件卸载时取消订阅，避免泄漏）
  useEffect(() => {
    const unsubscribe = window.dshw.onKnowledgeExtractProgress((p) => {
      setPercent(p.percent)
      setCurrentStep(p.step)
      setStepStates((prev) => ({
        ...prev,
        [p.step]: p.percent >= 100 ? 'done' : 'running',
        ...(p.percent >= 100 ? {} : prev)
      }))
    })
    return unsubscribe
  }, [])

  const loadRecent = async (): Promise<void> => {
    setLoadingRecent(true)
    try {
      const r = await window.dshw.getRecentSessionText()
      if (r.ok && r.text) {
        setText(r.text)
        setSessionTitle(r.title ?? '')
      } else if (!text) {
        setResultMsg(r.error ?? '未读取到会话内容，可手动粘贴')
      }
    } finally {
      setLoadingRecent(false)
    }
  }

  const resetSteps = (): void => {
    setPercent(0)
    setCurrentStep(null)
    setStepStates({ distill: 'pending', extract: 'pending', vector: 'pending', refine: 'pending', archive: 'pending' })
    setResultMsg('')
  }

  const onExtract = async (): Promise<void> => {
    setBusy(true)
    setResultMsg('')
    resetSteps()
    try {
      // 新建分类（needCategory 状态）
      if (needCategory) {
        const cat = await window.dshw.knowledgeCategoryCreate(newCategory)
        if (cat.ok && cat.category) {
          setCategoryId(cat.category.id)
          setNeedCategory(false)
          setNewCategory('')
          await window.dshw.knowledgeGet().then((p) => setCategories(p.categories))
        }
      }
      const res = await window.dshw.extractKnowledgePipeline({
        sessionText: text,
        categoryId: categoryId || undefined,
        sessionId: sessionTitle || undefined
      })
      if (res.ok) {
        setStepStates((prev) => {
          const next = { ...prev }
          for (const k of Object.keys(next) as ExtractStepKey[]) next[k] = 'done'
          return next
        })
        setPercent(100)
        setResultMsg(
          res.merged
            ? `✨ 检测到相似知识，已增量合并入「${res.categoryName}」`
            : `✨ 知识已提炼并存入「${res.categoryName}」`
        )
        toast(res.merged ? `知识已合并入「${res.categoryName}」` : `✨ 知识已提炼并存入「${res.categoryName}」`, 'success')
      } else if (res.needCategory) {
        setNeedCategory(true)
        setResultMsg('请先创建知识分类，再开始提炼')
      } else {
        if (res.failedStep) {
          setStepStates((prev) => ({ ...prev, [res.failedStep!]: 'error' }))
        }
        const stepName = STEPS.find((s) => s.key === res.failedStep)?.name ?? ''
        const msg = `${stepName ? stepName + '：' : ''}${res.error ?? '提炼失败'}`
        setResultMsg(msg)
        toast(msg, 'error')
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) resetSteps() }}>
      <Button size="sm" variant="violet" onClick={() => setOpen(true)}>
        <Sparkles className="h-3.5 w-3.5" /> 提炼会话
      </Button>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-cyber-violet" /> 一键智能提炼
          </DialogTitle>
          <DialogDescription>
            自动执行最佳 Skill 组合流水线（蒸馏 → 萃取 → 向量化 → 去重合并 → 归档），将当前会话转化为结构化知识卡片。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {/* 会话内容 */}
          <div className="flex items-center gap-2">
            <Textarea
              placeholder="会话内容（自动读取最近会话，或手动粘贴）…"
              value={text}
              onChange={(e) => setText(e.target.value)}
              className="min-h-[120px] font-mono text-xs"
            />
          </div>
          <div className="flex items-center gap-2">
            {sessionTitle && <Badge variant="outline" className="max-w-[200px] truncate">📄 {sessionTitle}</Badge>}
            <Button size="sm" variant="ghost" className="h-6 text-[11px]" onClick={() => void loadRecent()} disabled={loadingRecent || busy}>
              {loadingRecent ? <Loader2 className="h-3 w-3 animate-spin" /> : <FileText className="h-3 w-3" />} 读取最近会话
            </Button>
          </div>

          {/* 分类选择 */}
          <div className="flex items-center gap-2">
            <span className="shrink-0 text-xs text-cyber-dim">存入分类：</span>
            <select
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
              className="h-8 flex-1 rounded-lg border border-cyber-border bg-cyber-panel2 px-2 text-xs text-cyber-text focus:border-cyber-neon/60 focus:outline-none"
            >
              <option value="">请选择分类…</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          {needCategory && (
            <div className="flex items-center gap-2 rounded-lg border border-cyber-amber/40 bg-cyber-amber/10 px-3 py-2">
              <span className="text-xs text-cyber-amber">没有可用分类，请新建：</span>
              <Input
                value={newCategory}
                onChange={(e) => setNewCategory(e.target.value)}
                placeholder="新分类名称"
                className="h-7 flex-1 text-xs"
              />
            </div>
          )}

          {/* 流水线进度 */}
          {busy && (
            <div className="space-y-2 rounded-lg border border-cyber-border bg-cyber-panel2 p-3">
              <div className="flex items-center justify-between text-[11px] text-cyber-dim">
                <span>流水线进度</span>
                <span className="font-mono text-cyber-neon">{percent}%</span>
              </div>
              <Progress value={percent} />
              <div className="space-y-1">
                {STEPS.map((s) => {
                  const Icon = s.icon
                  const state = stepStates[s.key]
                  return (
                    <div key={s.key} className="flex items-center gap-2 text-[11px]">
                      {state === 'done' && <CheckCircle2 className="h-3 w-3 shrink-0 text-cyber-green" />}
                      {state === 'running' && <Loader2 className="h-3 w-3 shrink-0 animate-spin text-cyber-neon" />}
                      {state === 'error' && <XCircle className="h-3 w-3 shrink-0 text-cyber-red" />}
                      {state === 'pending' && <span className="h-3 w-3 shrink-0 rounded-full border border-cyber-border" />}
                      <Icon className={`h-3 w-3 shrink-0 ${currentStep === s.key ? 'text-cyber-neon' : 'text-cyber-faint'}`} />
                      <span className={state === 'done' ? 'text-cyber-dim' : state === 'error' ? 'text-cyber-red' : state === 'running' ? 'text-cyber-neon' : 'text-cyber-faint'}>
                        {s.name}
                      </span>
                      <span className="ml-auto text-[10px] text-cyber-faint">{s.desc}</span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* 结果 / 错误 */}
          {resultMsg && !busy && (
            <div
              className={`rounded-lg border p-3 text-xs ${
                resultMsg.startsWith('✨')
                  ? 'border-cyber-green/40 bg-cyber-green/10 text-cyber-green'
                  : 'border-cyber-red/40 bg-cyber-red/10 text-cyber-red'
              }`}
            >
              {resultMsg}
            </div>
          )}

          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
              关闭
            </Button>
            <Button size="sm" variant="violet" onClick={() => void onExtract()} disabled={busy || !text.trim() || !categoryId && !needCategory}>
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
              {busy ? '提炼中…' : '开始一键提炼'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
