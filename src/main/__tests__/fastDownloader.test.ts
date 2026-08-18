import { describe, expect, it, afterEach } from 'vitest'
import http from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { fastDownload, pickFastestMirror, sha256File, verifySha256File, DEFAULT_THREADS } from '../fastDownloader'

const tempDirs: string[] = []
function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dshw-dl-'))
  tempDirs.push(dir)
  return dir
}
afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

/** 支持 Range 的本地静态服务器；delayMs > 0 时延迟响应（模拟慢源）。 */
function serve(data: Buffer, delayMs = 0): Promise<{ url: string; close: () => void }> {
  const server = http.createServer((req, res) => {
    const respond = (): void => {
      const range = req.headers.range
      if (range) {
        const m = /bytes=(\d+)-(\d*)/.exec(range)
        if (m) {
          const start = Number(m[1])
          const end = m[2] ? Number(m[2]) : data.length - 1
          const slice = data.subarray(start, end + 1)
          res.writeHead(206, {
            'Content-Length': slice.length,
            'Content-Range': `bytes ${start}-${end}/${data.length}`,
            'Accept-Ranges': 'bytes'
          })
          res.end(slice)
          return
        }
      }
      res.writeHead(200, { 'Content-Length': data.length, 'Accept-Ranges': 'bytes' })
      res.end(data)
    }
    if (delayMs > 0) setTimeout(respond, delayMs)
    else respond()
  })
  return new Promise<{ url: string; close: () => void }>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address()
      resolve({ url: `http://127.0.0.1:${(addr as { port: number }).port}/file.bin`, close: () => server.close() })
    })
  })
}

describe('FastDownloader（多线程分片 / 续传 / 镜像测速）', () => {
  it('多线程下载：内容与源一致（大文件 8MB）', async () => {
    const src = crypto.randomBytes(8 * 1024 * 1024)
    const { url, close } = await serve(src)
    const dir = makeTempDir()
    const dest = path.join(dir, 'out.bin')
    const progress: number[] = []
    try {
      const result = await fastDownload({ url, dest, threads: 4, onProgress: (_r, _t, p) => progress.push(p) })
      expect(result.ok).toBe(true)
      expect(result.bytes).toBe(src.length)
      expect(fs.readFileSync(dest).equals(src)).toBe(true)
      expect(progress[progress.length - 1]).toBe(100)
    } finally {
      close()
    }
  })

  it('取消后保留分片，续传成功且内容一致', async () => {
    const src = crypto.randomBytes(16 * 1024 * 1024)
    const { url, close } = await serve(src, 300) // 慢源：确保 80ms 时仍在下载
    const dir = makeTempDir()
    const dest = path.join(dir, 'out.bin')
    try {
      const controller = new AbortController()
      const firstPromise = fastDownload({ url, dest, threads: 4, signal: controller.signal })
      // 探测 300ms 后进行中段取消（分片已建立但未完成）
      setTimeout(() => controller.abort(), 650)
      const first = await firstPromise
      expect(first.canceled).toBe(true)
      expect(fs.existsSync(dest + '.parts')).toBe(true)

      // 第二次完整下载：续传合并
      const second = await fastDownload({ url, dest, threads: 4 })
      expect(second.ok).toBe(true)
      expect(second.resumed).toBe(true)
      expect(fs.readFileSync(dest).equals(src)).toBe(true)
      expect(fs.existsSync(dest + '.parts')).toBe(false)
    } finally {
      close()
    }
  }, 60000)

  it('verifySha256File / sha256File', () => {
    const file = path.join(makeTempDir(), 'a.bin')
    fs.writeFileSync(file, 'hello')
    const hash = sha256File(file)
    expect(verifySha256File(file, hash)).toBe(true)
    expect(verifySha256File(file, '0'.repeat(64))).toBe(false)
  })

  it('pickFastestMirror：选择更快镜像；单候选直返', async () => {
    const slow = await serve(Buffer.alloc(10), 250)
    const fast = await serve(Buffer.alloc(10), 0)
    try {
      const picked = await pickFastestMirror([slow.url, fast.url])
      expect(picked).toBe(fast.url)
      expect(await pickFastestMirror([slow.url])).toBe(slow.url)
      expect(await pickFastestMirror([])).toBe('')
    } finally {
      slow.close()
      fast.close()
    }
  })

  it('默认 4 线程常量', () => {
    expect(DEFAULT_THREADS).toBe(4)
  })
})
