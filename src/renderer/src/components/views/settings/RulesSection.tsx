import { useEffect, useState } from 'react'
import type { JSX } from 'react'
import { ScrollText, Save, Loader2, FolderOpen } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../ui/card'
import { Button } from '../../ui/button'
import { Textarea } from '../../ui/textarea'
import { useToast } from '../../ui/toast'

/** 全局行为规则：查看 / 编辑永久指令（global-rules.md）。 */
export function RulesSection(): JSX.Element {
  const { toast } = useToast()
  const [content, setContent] = useState('')
  const [filePath, setFilePath] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    void window.dshw.getGlobalRules().then((r) => {
      setContent(r.content)
      setFilePath(r.path)
      setLoaded(true)
    })
  }, [])

  const save = async (): Promise<void> => {
    setSaving(true)
    try {
      const r = await window.dshw.saveGlobalRules(content)
      if (r.ok) {
        toast('全局行为规则已保存', 'success')
      } else {
        toast(r.error ?? '保存失败', 'error')
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="max-w-3xl space-y-4">
      <Card className="glow-border border-cyber-neon/30">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ScrollText className="h-4 w-4 text-cyber-neon" /> 全局行为规则
          </CardTitle>
          <CardDescription>
            系统级永久指令（问题解决优先级协议）。任何新会话、新项目、弹出子窗口均自动加载、默认执行。
            修改后对后续所有任务生效。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {loaded && (
            <Textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              className="min-h-[360px] font-mono text-xs leading-relaxed"
              spellCheck={false}
            />
          )}
          <div className="flex items-center justify-between">
            <Button size="sm" variant="ghost" className="text-[11px]" onClick={() => void window.dshw.openPath(filePath)}>
              <FolderOpen className="h-3.5 w-3.5" /> 打开文件位置
            </Button>
            <Button size="sm" variant="default" onClick={() => void save()} disabled={saving || !loaded}>
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} 保存规则
            </Button>
          </div>
          {filePath && <p className="break-all font-mono text-[10px] text-cyber-faint">落盘路径：{filePath}</p>}
        </CardContent>
      </Card>
    </div>
  )
}
