import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  createKnowledgeCategory,
  createKnowledgeEntry,
  deleteKnowledgeCategory,
  deleteKnowledgeEntry,
  extractKnowledgeToStore,
  getKnowledge,
  iterateKnowledge,
  renameKnowledgeCategory,
  searchKnowledge,
  updateKnowledgeEntry,
  heuristicKnowledgeExtractor
} from '../knowledge'

let dir: string

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-'))
})

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true })
})

describe('知识库：分类与条目 CRUD', () => {
  it('创建 / 重命名 / 删除分类，entryCount 随条目变化', () => {
    const cat = createKnowledgeCategory(dir, ' 会话经验 ')
    expect(cat.name).toBe('会话经验')
    createKnowledgeEntry(dir, cat.id, { title: 't1', content: 'c1', tags: ['a'] })
    const payload = getKnowledge(dir)
    expect(payload.categories[0].entryCount).toBe(1)
    renameKnowledgeCategory(dir, cat.id, '新名字')
    expect(getKnowledge(dir).categories[0].name).toBe('新名字')
    deleteKnowledgeCategory(dir, cat.id)
    expect(getKnowledge(dir).categories).toHaveLength(0)
    expect(getKnowledge(dir).entries).toHaveLength(0)
  })

  it('更新 / 删除条目并校验 updatedAt', () => {
    const cat = createKnowledgeCategory(dir, 'c')
    const entry = createKnowledgeEntry(dir, cat.id, { title: 't', content: 'x' })
    const old = entry.updatedAt
    updateKnowledgeEntry(dir, entry.id, { title: 't2', content: 'y', tags: ['k'] })
    const updated = getKnowledge(dir).entries[0]
    expect(updated.title).toBe('t2')
    expect(updated.tags).toEqual(['k'])
    expect(updated.updatedAt).toBeGreaterThanOrEqual(old)
    deleteKnowledgeEntry(dir, entry.id)
    expect(getKnowledge(dir).entries).toHaveLength(0)
  })

  it('非法分类 / 空分类名校验', () => {
    expect(() => createKnowledgeCategory(dir, '  ')).toThrow('分类名不能为空')
    const cat = createKnowledgeCategory(dir, 'c')
    expect(() => createKnowledgeEntry(dir, 'nope', { title: 't', content: 'x' })).toThrow('分类不存在')
    expect(() => updateKnowledgeEntry(dir, 'nope', { title: 't' })).toThrow('条目不存在')
    expect(() => renameKnowledgeCategory(dir, cat.id, '')).toThrow('分类名不能为空')
  })
})

describe('知识库：检索', () => {
  it('按关键词 / 分类过滤', () => {
    const catA = createKnowledgeCategory(dir, 'A')
    const catB = createKnowledgeCategory(dir, 'B')
    createKnowledgeEntry(dir, catA.id, { title: 'React 优化', content: 'memo 用法', tags: ['react'] })
    createKnowledgeEntry(dir, catB.id, { title: 'Vue 优化', content: 'computed', tags: ['vue'] })
    const kw = searchKnowledge(dir, { keyword: '优化' })
    expect(kw.entries).toHaveLength(2)
    const byCat = searchKnowledge(dir, { keyword: 'react', categoryId: catA.id })
    expect(byCat.entries).toHaveLength(1)
    expect(byCat.entries[0].title).toContain('React')
  })
})

describe('知识库：启发式提炼（SkillAdapter Mock）', () => {
  it('识别代码块与经验段落并去重', async () => {
    const text = [
      '```js',
      '// 深拷贝',
      'const clone = (o) => JSON.parse(JSON.stringify(o))',
      '```',
      '经验：对含 Date 的对象不要用 JSON 深拷贝。',
      '经验：对含 Date 的对象不要用 JSON 深拷贝。'
    ].join('\n')
    const items = await heuristicKnowledgeExtractor.extract({ sessionText: text })
    expect(items.length).toBeGreaterThanOrEqual(2)
    expect(items.some((i) => i.content.includes('const clone'))).toBe(true)
    // 完全重复段落只保留一条
    const exp = items.filter((i) => i.tags.includes('经验'))
    expect(exp.length).toBe(1)
  })

  it('无分类时返回 needCategory', async () => {
    const result = await extractKnowledgeToStore(dir, { sessionText: '经验：x' })
    expect(result.needCategory).toBe(true)
    expect(result.ok).toBe(false)
  })

  it('提炼入库成功', async () => {
    const cat = createKnowledgeCategory(dir, '经验')
    const result = await extractKnowledgeToStore(dir, {
      sessionText: '```py\n# solve\nprint(1)\n```\n经验：先验证再优化。',
      categoryId: cat.id
    })
    expect(result.ok).toBe(true)
    expect((result.entries ?? []).length).toBeGreaterThanOrEqual(2)
    expect(getKnowledge(dir).entries.length).toBeGreaterThanOrEqual(2)
  })
})

describe('知识库：合并去重迭代', () => {
  it('同标题归一化合并、保留最长内容与标签并集', () => {
    const cat = createKnowledgeCategory(dir, 'c')
    createKnowledgeEntry(dir, cat.id, { title: '缓存 策略', content: 'short', tags: ['a'] })
    createKnowledgeEntry(dir, cat.id, { title: '缓存策略', content: 'long content here', tags: ['b'] })
    const result = iterateKnowledge(dir)
    expect(result.removed).toBe(1)
    const entries = getKnowledge(dir).entries
    expect(entries).toHaveLength(1)
    expect(entries[0].content).toBe('long content here')
    expect(entries[0].tags).toEqual(expect.arrayContaining(['a', 'b']))
  })

  it('无重复时保持原样', () => {
    const cat = createKnowledgeCategory(dir, 'c')
    createKnowledgeEntry(dir, cat.id, { title: 'A', content: '1' })
    createKnowledgeEntry(dir, cat.id, { title: 'B', content: '2' })
    const result = iterateKnowledge(dir)
    expect(result.removed).toBe(0)
    expect(getKnowledge(dir).entries).toHaveLength(2)
  })
})
