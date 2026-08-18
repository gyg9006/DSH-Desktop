import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

describe('e2e: installDsh 内置启用（真实内置包，干净工作区）', () => {
  it('runInstall dsh → 内置 dsh-cli 安装到工作区并装依赖', async () => {
    const envDir = path.join(process.cwd(), 'resources', 'portable-env')
    if (!fs.existsSync(path.join(envDir, 'env-manifest.json'))) return // 未生成内置包时跳过
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'dshw-dsh-e2e-'))
    const logs: string[] = []
    const prev = process.env.DSH_PORTABLE_ENV_DIR
    process.env.DSH_PORTABLE_ENV_DIR = envDir
    try {
      const { runInstall } = await import('../installer')
      const result = await runInstall(ws, 'dsh', 'install', {
        log: (m) => logs.push(m),
        progress: () => undefined
      })
      console.log('RESULT:', JSON.stringify(result))
      console.log('LOGS:', logs.slice(-15).join('\n'))
      console.log('NODE_DIR:', fs.existsSync(path.join(ws, 'runtime', 'node')) ? fs.readdirSync(path.join(ws, 'runtime', 'node')).slice(0, 15).join(',') : 'MISSING')
      console.log('WS_RUNTIME:', fs.readdirSync(path.join(ws, 'runtime')).join(','))
      expect(result.ok).toBe(true)
      const pkgDir = path.join(ws, 'runtime', 'dsh', 'node_modules', '@deepseek-ai', 'dsh')
      const pkgPath = path.join(pkgDir, 'package.json')
      expect(fs.existsSync(pkgPath)).toBe(true)
      // node 已启用（ensureNode）
      expect(fs.existsSync(path.join(ws, 'runtime', 'node', 'node.exe'))).toBe(true)
      // dsh bin 可执行（依赖就绪 → dsh --version 成功）
      const bin = path.join(pkgDir, 'lib', 'bin.js')
      expect(fs.existsSync(bin)).toBe(true)
      const { runCommand } = await import('../utils/process')
      const ver = await runCommand({
        command: path.join(ws, 'runtime', 'node', 'node.exe'),
        args: [bin, '--version'],
        cwd: path.join(ws, 'runtime', 'dsh'),
        timeoutMs: 60000
      })
      console.log('DSH_VERSION_RUN:', JSON.stringify({ error: ver.error, stdout: ver.stdout }))
      expect(ver.error).toBeFalsy()
      expect(ver.stdout.trim().length).toBeGreaterThan(0)
    } finally {
      fs.rmSync(ws, { recursive: true, force: true })
      if (prev === undefined) delete process.env.DSH_PORTABLE_ENV_DIR
      else process.env.DSH_PORTABLE_ENV_DIR = prev
    }
  }, 300000)
})
