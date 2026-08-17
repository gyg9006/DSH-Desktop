import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { hashVector, cosineSimilarity, runExtractionPipeline, readRecentSessionText } from '../skillOrchestrator'
import { createKnowledgeCategory, getKnowledge } from '../knowledge'

let dir: string

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pipe-'))
  fs.mkdirSync(path.join(dir, 'config'), { recursive: true })
  fs.mkdirSync(path.join(dir, 'data'), { recursive: true })
})

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true })
})

describe('向量化：hashVector / cosineSimilarity', () => {
  it('相同文本向量相似度为 1', () => {
    const a = hashVector('React 组件优化 缓存')
    const b = hashVector('React 组件优化 缓存')
    expect(cosineSimilarity(a, b)).toBeCloseTo(1, 5)
  })

  it('不同文本相似度更低', () => {
    const a = hashVector('React 组件优化 缓存')
    const b = hashVector('数据库索引与查询优化')
    const c = hashVector('React 组件优化 缓存')
    expect(cosineSimilarity(a, b)).toBeLessThan(cosineSimilarity(a, c))
  })
})

describe('一键智能提炼流水线', () => {
  it('全链路：蒸馏→萃取→向量→归档→索引（新建）', async () => {
    const cat = createKnowledgeCategory(dir, '经验')
    const progress: string[] = []
    const result = await runExtractionPipeline(
      dir,
      {
        sessionText: '```ts\n// 防抖\nfunction debounce(fn, ms){ let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a), ms) } }\n```\n经验：防抖用于输入事件。',
        categoryId: cat.id
      },
      (p) => progress.push(`${p.step}:${p.percent}`)
    )
    expect(result.ok).toBe(true)
    expect(result.saved).toBe(1)
    expect(result.categoryName).toBe('经验')
    // 归档 md 文件
    expect(result.files?.length).toBe(1)
    const mdPath = result.files![0]
    expect(fs.existsSync(mdPath)).toBe(true)
    const md = fs.readFileSync(mdPath, 'utf8')
    expect(md).toContain('created_at:')
    expect(md).toContain('source_session_id:')
    expect(md).toContain('version: 1')
    expect(md).toContain('## 代码片段')
    // 索引条目
    const kb = getKnowledge(dir)
    expect(kb.entries.length).toBe(1)
    expect(kb.entries[0].tags).toContain('提炼')
    // 进度按序上报
    expect(progress[0]).toContain('distill')
    expect(progress[progress.length - 1]).toBe('archive:100')
  })

  it('重复提炼 → 相似知识增量合并（merged=1）', async () => {
    const cat = createKnowledgeCategory(dir, '经验')
    const sessionText = '```ts\n// 防抖\nfunction debounce(fn, ms){ let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a), ms) } }\n```\n经验：防抖用于输入事件。'
    const r1 = await runExtractionPipeline(dir, { sessionText, categoryId: cat.id }, () => undefined)
    expect(r1.ok).toBe(true)
    const r2 = await runExtractionPipeline(dir, { sessionText: sessionText + ' 补充：节流用于滚动。', categoryId: cat.id }, () => undefined)
    expect(r2.ok).toBe(true)
    expect(r2.merged).toBe(1)
    expect(r2.saved).toBe(0)
    const kb = getKnowledge(dir)
    expect(kb.entries.length).toBe(1) // 合并后仍 1 条
  })

  it('无分类 → needCategory', async () => {
    const result = await runExtractionPipeline(dir, { sessionText: '经验：x' }, () => undefined)
    expect(result.ok).toBe(false)
    expect(result.needCategory).toBe(true)
  })
})

describe('读取最近会话文本', () => {
  it('解析 JSONL 用户消息（zstd 与非压缩）', () => {
    const sessionDir = path.join(dir, 'data', 'sessions', 'proj', 's1')
    fs.mkdirSync(sessionDir, { recursive: true })
    const lines = [
      JSON.stringify({ type: 'session', version: 0, id: 's1', createdAt: 1, cwd: dir, agentPreset: 'standard' }),
      JSON.stringify({ type: 'user/message', seq: 1, time: 2, data: { content: [{ type: 'text', text: '你好' }] } }),
      JSON.stringify({ type: 'assistant/message', seq: 2, time: 3, data: { content: [{ type: 'text', text: '你好！' }] } }),
      JSON.stringify({ type: 'user/message', seq: 3, time: 4, data: { content: [{ type: 'text', text: '帮我优化这段代码' }] } })
    ]
    fs.writeFileSync(path.join(sessionDir, 'session.jsonl'), lines.join('\n'), 'utf8')
    const r = readRecentSessionText(dir)
    expect(r.ok).toBe(true)
    expect(r.title).toBe('s1')
    expect(r.text).toContain('帮我优化这段代码')
    expect(r.text).toContain('你好')
    expect(r.text).not.toContain('你好！') // 不含 assistant 消息
  })

  it('无会话返回错误', () => {
    const r = readRecentSessionText(dir)
    expect(r.ok).toBe(false)
  })
})
