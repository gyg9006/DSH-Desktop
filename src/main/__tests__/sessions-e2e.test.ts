import { describe, expect, it, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createZstdDecompress } from 'node:zlib'
import { importSessionsFrom } from '../sessions'

const tempDirs: string[] = []
function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dshw-e2e-'))
  tempDirs.push(dir)
  return dir
}
afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

function decodeZstd(file: string): Buffer {
  // 与 dsh 相同的逐帧解码：按 zstd 帧头解析边界，逐帧 zstdDecompressSync
  const { zstdDecompressSync } = require('node:zlib')
  const data = fs.readFileSync(file)
  const ZSTD_MAGIC = 0xfd2fb528
  function frameHeaderSize(buffer: Buffer, start: number): number {
    try {
      const descriptor = buffer[start + 4]
      if (descriptor === undefined) return -1
      const fcsFlag = (descriptor >> 6) & 0b11
      const singleSegment = (descriptor >> 5) & 1
      let offset = start + 5
      if (!singleSegment) offset += 1
      let contentSize = -1
      if (fcsFlag === 0) {
        contentSize = singleSegment ? buffer.readUInt8(offset) : -1
        offset += singleSegment ? 1 : 0
      } else if (fcsFlag === 1) {
        contentSize = buffer.readUInt16LE(offset)
        offset += 2
      } else if (fcsFlag === 2) {
        contentSize = buffer.readUInt32LE(offset)
        offset += 4
      } else if (fcsFlag === 3) {
        contentSize = Number(buffer.readBigUInt64LE(offset))
        offset += 8
      }
      if (contentSize < 0) return -1
      return offset + contentSize
    } catch {
      return -1
    }
  }
  const frames: Array<{ start: number; end: number }> = []
  let offset = 0
  while (offset + 4 <= data.length) {
    if (data.readUInt32LE(offset) !== ZSTD_MAGIC) break
    const len = frameHeaderSize(data, offset)
    if (len <= 0) break
    const end = offset + len
    if (end > data.length) break
    frames.push({ start: offset, end })
    offset = end
  }
  if (frames.length === 0) return zstdDecompressSync(data)
  return Buffer.concat(frames.map((f) => zstdDecompressSync(data.subarray(f.start, f.end))))
}

describe('端到端：官方导出（明文 session.jsonl 54MB）导入后内容完整', () => {
  it('导入明文大会话 → zstd 分帧 → 行数与内容保留', async () => {
    const src = path.join(os.tmpdir(), 'dshw-export-clean', 'session.jsonl')
    if (!fs.existsSync(src)) return // 未生成模拟数据时跳过
    const originalLines = fs.readFileSync(src, 'utf8').split('\n').filter(Boolean).length
    const srcHeader = JSON.parse(fs.readFileSync(src, 'utf8').split('\n')[0])
    // eslint-disable-next-line no-console
    console.log('src header id:', srcHeader.id, '| lines:', originalLines)

    const ws = makeTempDir()
    fs.mkdirSync(path.join(ws, 'data', 'storages'), { recursive: true })
    fs.writeFileSync(
      path.join(ws, 'data', 'storages', 'workspace.json'),
      JSON.stringify({
        unit: { name: 'workspace', version: 2 },
        global: { initialized: true, workspaceIds: ['ws-1'], archivedSessionIds: [] },
        tables: {
          workspaces: {
            'ws-1': { path: 'F:\\deepseek_workspace', title: 'work', sessionIds: [], createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }
          }
        }
      })
    )

    const result = await importSessionsFrom(ws, [src])
    // eslint-disable-next-line no-console
    console.log('import result:', JSON.stringify(result))
    expect(result.ok).toBe(true)
    expect(result.count).toBe(1)

    // 搜索导入后的会话目录（位置由 header cwd/id 决定）
    const sessionsRoot = path.join(ws, 'data', 'sessions')
    const candidates: string[] = []
    const walkTree = (dir: string, depth: number): void => {
      if (!fs.existsSync(dir)) return
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name)
        if (e.isDirectory()) {
          if (e.name === 'session-import-e2e-test') candidates.push(full)
          if (depth < 4) walkTree(full, depth + 1)
        }
      }
    }
    walkTree(sessionsRoot, 0)
    // eslint-disable-next-line no-console
    console.log('sessions tree:', JSON.stringify(fs.existsSync(sessionsRoot) ? fs.readdirSync(sessionsRoot) : '(missing)'))
    // eslint-disable-next-line no-console
    console.log('sessions root exists:', fs.existsSync(sessionsRoot), '| contents:', JSON.stringify(fs.existsSync(sessionsRoot) ? fs.readdirSync(sessionsRoot) : 'none'))
    const groupDir = path.join(sessionsRoot, '--F-deepseek_workspace--')
    // eslint-disable-next-line no-console
    console.log('group contents:', JSON.stringify(fs.existsSync(groupDir) ? fs.readdirSync(groupDir) : '(missing)'))
    // eslint-disable-next-line no-console
    console.log('expected target exists:', fs.existsSync(path.join(groupDir, 'session-import-e2e-test', 'session.jsonl.zstd')))
    console.log('candidates:', JSON.stringify(candidates))
    expect(candidates.length).toBe(1)
    const target = path.join(candidates[0], 'session.jsonl.zstd')
    expect(fs.existsSync(target)).toBe(true)

    const decoded = await decodeZstd(target)
    const decodedLines = decoded.toString('utf8').split('\n').filter(Boolean).length
    expect(decodedLines).toBe(originalLines)
    // header 保留
    const header = JSON.parse(decoded.toString('utf8').split('\n')[0])
    expect(header.id).toBe('session-import-e2e-test')
    expect(header.cwd).toBe('F:\\deepseek_workspace')
  }, 120000)
})
