/**
 * Mock GitHub Releases API + 静态文件服务器（端到端更新验证用）。
 * 模拟：GET /repos/gyg9006/DSH-Desktop/releases/latest → 返回指定版本 release
 *       （默认 v2.1.6，高于本地版本即触发更新流程）；zip 与 SHA256SUMS 走真实本地文件，
 *       支持 HEAD + Range（FastDownloader 多线程/续传/测速所需）。
 * 用法：node scripts/mock-update-server.mjs <zipPath> <sha256Path> [port=18080] [version=v2.1.6]
 */
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'

const [zipPath, sha256Path, portArg, verArg] = process.argv.slice(2)
const PORT = Number(portArg ?? 18080)
const VERSION = verArg ?? 'v2.1.6'
if (!zipPath || !sha256Path) {
  console.error('usage: node scripts/mock-update-server.mjs <zipPath> <sha256Path> [port] [version]')
  process.exit(1)
}
const zipSize = fs.statSync(zipPath).size
const checksumText = fs.readFileSync(sha256Path, 'utf8')
const zipName = path.basename(zipPath)
const base = `http://127.0.0.1:${PORT}`

const server = http.createServer((req, res) => {
  const url = req.url ?? ''

  // ---- GitHub API：releases/latest ----
  if (url === '/repos/gyg9006/DSH-Desktop/releases/latest') {
    const payload = {
      tag_name: VERSION,
      name: `DSH 桌面 ${VERSION}`,
      body: 'mock release for e2e update test',
      html_url: `${base}/release`,
      assets: [
        { id: 1, name: zipName, size: zipSize, browser_download_url: `${base}/${zipName}`, content_type: 'application/zip' },
        { id: 2, name: 'SHA256SUMS', size: Buffer.byteLength(checksumText), browser_download_url: `${base}/SHA256SUMS`, content_type: 'text/plain' }
      ]
    }
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' })
    res.end(JSON.stringify(payload))
    return
  }

  // ---- SHA256SUMS ----
  if (url === '/SHA256SUMS') {
    res.writeHead(200, { 'Content-Type': 'text/plain' })
    res.end(checksumText)
    return
  }

  // ---- 更新包 zip（HEAD + Range 支持） ----
  if (url === `/${zipName}`) {
    if (req.method === 'HEAD') {
      res.writeHead(200, { 'Content-Length': zipSize, 'Accept-Ranges': 'bytes', 'Content-Type': 'application/zip' })
      res.end()
      return
    }
    const range = req.headers.range
    if (range) {
      const m = /bytes=(\d+)-(\d*)/.exec(range)
      if (m) {
        const start = Number(m[1])
        const end = m[2] ? Math.min(Number(m[2]), zipSize - 1) : zipSize - 1
        const length = end - start + 1
        res.writeHead(206, {
          'Content-Length': length,
          'Content-Range': `bytes ${start}-${end}/${zipSize}`,
          'Accept-Ranges': 'bytes',
          'Content-Type': 'application/zip'
        })
        const stream = fs.createReadStream(zipPath, { start, end })
        stream.pipe(res)
        return
      }
    }
    res.writeHead(200, { 'Content-Length': zipSize, 'Accept-Ranges': 'bytes', 'Content-Type': 'application/zip' })
    fs.createReadStream(zipPath).pipe(res)
    return
  }

  res.writeHead(404)
  res.end('not found')
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[mock-update] listening on ${base}`)
  console.log(`[mock-update] latest release: v2.1.1 (asset ${zipName}, ${(zipSize / 1024 / 1024).toFixed(1)} MB)`)
})
