/**
 * FastDownloader（需求一）：多线程 Range 分片下载 + 断点续传 + SHA256 校验 + 镜像测速。
 *
 * - 默认 4 线程：HEAD 探测大小与 Range 支持 → 均分区间 → 每线程一个 Range 请求流式落盘；
 * - 断点续传：分片落 <dest>.parts/part-N，meta.json 记录 url/总数/分片大小；
 *   再次下载同 url 时按分片已存在字节续传；
 * - 取消：abort 全部请求，保留分片供续传；
 * - 镜像测速：pickFastestMirror 对候选 url 发 Range: bytes=0-0 首字节计时，选最快；
 * - 校验：sha256Of 校验下载结果（由调用方决定重试/换镜像）。
 * 全部使用 Node 24 原生 fetch，零依赖。
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

export interface FastDownloadOptions {
  url: string
  dest: string
  /** 分片线程数（默认 4；Range 不支持时降级单流） */
  threads?: number
  signal?: AbortSignal
  onProgress?: (received: number, total: number, percent: number) => void
  /** 进度节流（ms，默认 200） */
  throttleMs?: number
}

export interface FastDownloadResult {
  ok: boolean
  canceled?: boolean
  error?: string
  bytes?: number
  resumed?: boolean
}

export const DEFAULT_THREADS = 4

export function sha256File(file: string): string {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}

export function verifySha256File(file: string, expected: string): boolean {
  try {
    return sha256File(file) === expected.toLowerCase()
  } catch {
    return false
  }
}

interface ProbeResult {
  total: number
  supportsRange: boolean
}

async function probe(url: string, signal: AbortSignal | undefined): Promise<ProbeResult> {
  const res = await fetch(url, { method: 'HEAD', redirect: 'follow', signal })
  if (!res.ok) throw new Error(`HEAD 失败：HTTP ${res.status}`)
  const total = Number(res.headers.get('content-length') ?? 0)
  const acceptsRange = /bytes/i.test(res.headers.get('accept-ranges') ?? '')
  return { total, supportsRange: acceptsRange }
}

/** 单段下载：从 start+offset 续传，写入 fd 的指定偏移。 */
async function downloadSegment(
  url: string,
  start: number,
  end: number,
  fd: number,
  offset: number,
  signal: AbortSignal | undefined,
  onBytes: (n: number) => void
): Promise<void> {
  const range = `bytes=${start + offset}-${end}`
  const res = await fetch(url, { redirect: 'follow', signal, headers: { Range: range } })
  if (!res.ok || !res.body) {
    if (res.status === 416 && offset > 0) return // 已下载完整
    throw new Error(`分片下载失败：HTTP ${res.status}`)
  }
  const reader = res.body.getReader()
  let written = offset
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    const buf = Buffer.from(value.buffer, value.byteOffset, value.byteLength)
    await new Promise<void>((resolve, reject) => {
      fs.write(fd, buf, 0, buf.length, written, (err) => (err ? reject(err) : resolve()))
    })
    written += buf.length
    onBytes(buf.length)
  }
}

interface PartsMeta {
  url: string
  total: number
  threads: number
  sizes: number[]
}

function partsDirOf(dest: string): string {
  return dest + '.parts'
}

function metaPathOf(dest: string): string {
  return path.join(partsDirOf(dest), 'meta.json')
}

function readPartsMeta(dest: string): PartsMeta | null {
  try {
    const raw = JSON.parse(fs.readFileSync(metaPathOf(dest), 'utf8')) as PartsMeta
    return raw && typeof raw.url === 'string' ? raw : null
  } catch {
    return null
  }
}

/**
 * 多线程分片下载（支持续传）。
 * 流程：HEAD 探测 → 建立/复用 .parts → 各线程并发 Range 下载 → 合并 → 清理分片。
 */
export async function fastDownload(opts: FastDownloadOptions): Promise<FastDownloadResult> {
  const { url, dest, signal } = opts
  const threads = Math.max(1, Math.min(16, opts.threads ?? DEFAULT_THREADS))
  const throttleMs = opts.throttleMs ?? 200
  let resumed = false

  try {
    // 1. 探测
    const probeResult = await probe(url, signal)

    // 2. 分片规划（复用已有 meta 续传；分片大小以实际文件为准）
    fs.mkdirSync(partsDirOf(dest), { recursive: true })
    const prev = readPartsMeta(dest)
    let total = probeResult.total
    let sizes: number[]
    if (prev && prev.url === url && prev.total === total && prev.threads === threads) {
      sizes = new Array<number>(threads)
      for (let i = 0; i < threads; i++) {
        try {
          sizes[i] = fs.statSync(path.join(partsDirOf(dest), `part-${i}`)).size
        } catch {
          sizes[i] = 0
        }
      }
      resumed = true
    } else {
      sizes = new Array<number>(threads).fill(0)
    }
    if (!probeResult.supportsRange || total <= 0) {
      // 无 Range / 未知大小 → 单流整包下载（无续传）
      return await singleStream(url, dest, total, signal, opts.onProgress, throttleMs)
    }
    fs.writeFileSync(metaPathOf(dest), JSON.stringify({ url, total, threads, sizes }))

    // 3. 并发下载各分片
    let received = total - sizes.reduce((a, b) => a + b, 0)
    let lastEmit = 0
    const emit = (): void => {
      const now = Date.now()
      if (now - lastEmit >= throttleMs || received === total) {
        lastEmit = now
        opts.onProgress?.(received, total, total > 0 ? Math.min(100, Math.round((received / total) * 100)) : 0)
      }
    }
    emit()

    const jobs: Promise<void>[] = []
    for (let i = 0; i < threads; i++) {
      const start = chunkStart(i, total, threads)
      const end = chunkEnd(i, total, threads)
      const partPath = path.join(partsDirOf(dest), `part-${i}`)
      jobs.push(
        (async () => {
          let existing = 0
          try {
            existing = fs.statSync(partPath).size
          } catch {
            existing = 0
          }
          const fd = fs.openSync(partPath, 'a')
          try {
            await downloadSegment(url, start, end, fd, existing, signal, (n) => {
              received += n
              sizes[i] = Math.min(sizes[i] + n, end - start + 1)
              emit()
            })
          } finally {
            fs.closeSync(fd)
          }
        })()
      )
    }
    await Promise.all(jobs)
    if (signal?.aborted) {
      return { ok: false, canceled: true, resumed }
    }

    // 4. 合并分片 → 目标文件（显式 position 写入不推进文件位置，需手动累计偏移）
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    const out = fs.openSync(dest, 'w')
    let pos = 0
    try {
      for (let i = 0; i < threads; i++) {
        const partPath = path.join(partsDirOf(dest), `part-${i}`)
        const buf = fs.readFileSync(partPath)
        fs.writeSync(out, buf, 0, buf.length, pos)
        pos += buf.length
      }
    } finally {
      fs.closeSync(out)
    }
    fs.rmSync(partsDirOf(dest), { recursive: true, force: true })
    opts.onProgress?.(total, total, 100)
    return { ok: true, bytes: total, resumed }
  } catch (error) {
    if (signal?.aborted) return { ok: false, canceled: true, resumed }
    return { ok: false, error: error instanceof Error ? error.message : String(error), resumed }
  }
}

function chunkStart(i: number, total: number, threads: number): number {
  const size = Math.ceil(total / threads)
  return i * size
}

function chunkEnd(i: number, total: number, threads: number): number {
  const size = Math.ceil(total / threads)
  return Math.min(total - 1, (i + 1) * size - 1)
}

/** 单流下载（Range 不支持 / 未知大小）：写临时文件后原子改名，失败保留 .part 供重试。 */
async function singleStream(
  url: string,
  dest: string,
  total: number,
  signal: AbortSignal | undefined,
  onProgress?: (received: number, total: number, percent: number) => void,
  throttleMs = 200
): Promise<FastDownloadResult> {
  const tmp = dest + '.tmp'
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  let received = 0
  try {
    const res = await fetch(url, { redirect: 'follow', signal })
    if (!res.ok || !res.body) throw new Error(`下载失败：HTTP ${res.status}`)
    const reader = res.body.getReader()
    const fd = fs.openSync(tmp, 'w')
    let lastEmit = 0
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        fs.writeSync(fd, Buffer.from(value.buffer, value.byteOffset, value.byteLength))
        received += value.byteLength
        const now = Date.now()
        if (now - lastEmit >= throttleMs || received === total) {
          lastEmit = now
          onProgress?.(received, total, total > 0 ? Math.min(100, Math.round((received / total) * 100)) : 0)
        }
      }
    } finally {
      fs.closeSync(fd)
    }
    fs.renameSync(tmp, dest)
    onProgress?.(received, total, 100)
    return { ok: true, bytes: received }
  } catch (error) {
    if (signal?.aborted) return { ok: false, canceled: true }
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

/** 对候选镜像 URL 测速（Range bytes=0-0 首字节计时），返回最快者；全部失败回退第一个。 */
export async function pickFastestMirror(urls: string[], timeoutMs = 4000): Promise<string> {
  if (urls.length <= 1) return urls[0] ?? ''
  const results = await Promise.all(
    urls.map(async (url) => {
      try {
        const started = Date.now()
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), timeoutMs)
        const res = await fetch(url, { redirect: 'follow', signal: controller.signal, headers: { Range: 'bytes=0-0' } })
        const firstByte = Date.now() - started
        clearTimeout(timer)
        if (!res.ok) return { url, ms: Infinity }
        await res.body?.cancel().catch(() => undefined)
        return { url, ms: firstByte }
      } catch {
        return { url, ms: Infinity }
      }
    })
  )
  const sorted = results.filter((r) => r.ms !== Infinity).sort((a, b) => a.ms - b.ms)
  return sorted[0]?.url ?? urls[0]
}
