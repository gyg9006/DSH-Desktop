import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { CURATED_SKILLS, listInstalledSkills, parseTar, skillMarketItems } from '../skillsMarket'

let tmp: string

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dshw-skill-test-'))
})

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true })
})

/** 构造最小 tar（未压缩），用于 parseTar 单测。 */
function buildTar(files: Array<{ name: string; content: string }>): Buffer {
  const chunks: Buffer[] = []
  for (const f of files) {
    const header = Buffer.alloc(512)
    header.write(f.name, 0, 'utf8')
    const size = Buffer.from(f.content, 'utf8').length
    header.write(size.toString(8).padStart(12, '0'), 124, 'utf8')
    header.write('00000000000', 148, 'utf8') // mtime
    header.write('0000000', 108, 'utf8') // mode
    header.write('0000000', 116, 'utf8') // uid
    header.write('0000000', 124 + 16, 'utf8') // gid
    header[156] = 0x30 // '0' file type
    header.write('0'.repeat(8), 136, 'utf8') // checksum placeholder
    let sum = 0
    for (const b of header) sum += b
    header.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 'utf8')
    chunks.push(header)
    chunks.push(Buffer.from(f.content, 'utf8'))
    const pad = 512 - (size % 512)
    if (pad < 512) chunks.push(Buffer.alloc(pad))
  }
  chunks.push(Buffer.alloc(1024)) // 结束块
  return Buffer.concat(chunks)
}

describe('CURATED_SKILLS 目录', () => {
  it('全部含中文名称与描述，来源合法', () => {
    expect(CURATED_SKILLS.length).toBeGreaterThanOrEqual(8)
    for (const s of CURATED_SKILLS) {
      expect(s.name.length).toBeGreaterThan(0)
      expect(s.description.length).toBeGreaterThan(0)
      expect(s.tags.length).toBeGreaterThan(0)
      expect(s.recommended).toBe(true)
      if (s.source.type === 'github') {
        expect(s.source.repo).toMatch(/^[\w-]+\/[\w.-]+$/)
        expect(s.source.path.length).toBeGreaterThan(0)
      } else {
        expect(s.source.pkg.length).toBeGreaterThan(0)
      }
    }
  })
})

describe('parseTar（npm 技能包解包）', () => {
  it('解析文件与目录条目', () => {
    const tar = buildTar([
      { name: 'package/', content: '' },
      { name: 'package/skills/pdf/SKILL.md', content: '# pdf skill' },
      { name: 'package/skills/pdf/reference/extra.md', content: 'ref' }
    ])
    const entries = parseTar(tar)
    const names = entries.map((e) => e.path)
    expect(names).toContain('package/skills/pdf/SKILL.md')
    expect(names).toContain('package/skills/pdf/reference/extra.md')
  })
})

describe('listInstalledSkills / skillMarketItems', () => {
  it('扫描 workspace/skills 中含 SKILL.md 的目录', () => {
    const root = path.join(tmp, 'skills')
    fs.mkdirSync(path.join(root, 'docx'), { recursive: true })
    fs.writeFileSync(path.join(root, 'docx', 'SKILL.md'), '# docx')
    fs.mkdirSync(path.join(root, 'no-skill'), { recursive: true })
    fs.writeFileSync(path.join(root, 'no-skill', 'readme.md'), 'x')
    const list = listInstalledSkills(tmp)
    expect(list.map((s) => s.id)).toEqual(['docx'])
  })

  it('market items 标记已安装', () => {
    fs.mkdirSync(path.join(tmp, 'skills', 'docx'), { recursive: true })
    fs.writeFileSync(path.join(tmp, 'skills', 'docx', 'SKILL.md'), '# docx')
    const items = skillMarketItems(tmp)
    const docx = items.find((s) => s.id === 'docx')
    expect(docx?.installed).toBe(true)
    const others = items.find((s) => s.id !== 'docx')
    expect(others?.installed).toBe(false)
  })
})
