/**
 * 初始化 / 出厂重置（需求：把应用给别人使用前恢复干净状态）。
 * 清空业务数据（对话/技能/插件/凭据/配置/工作路径），可选保留运行环境。
 */
import fs from 'node:fs'
import path from 'node:path'
import { getWorkspaceDir, getRootDir } from './config'
import { logger } from './logger'
import { stopDshService } from './dshService'

function clearDirContents(dir: string): void {
  if (!fs.existsSync(dir)) return
  for (const entry of fs.readdirSync(dir)) {
    fs.rmSync(path.join(dir, entry), { recursive: true, force: true })
  }
}

/** 清空业务数据（纯逻辑，可单测）：data/skills/plugins/backups + 配置目录；keepRuntime 控制是否保留 runtime。 */
export function clearBusinessData(workspaceDir: string, keepRuntime: boolean): void {
  for (const dir of ['data', 'skills', 'plugins', 'backups']) {
    clearDirContents(path.join(workspaceDir, dir))
  }
  clearDirContents(path.join(workspaceDir, 'config'))
  if (!keepRuntime) {
    clearDirContents(path.join(workspaceDir, 'runtime'))
  }
}

/**
 * 重置应用为干净状态。
 * @param keepRuntime 是否保留运行环境（runtime/），默认保留（开箱即用）
 */
export async function resetApp(keepRuntime: boolean): Promise<{ ok: boolean; message: string }> {
  try {
    // 停止服务
    await stopDshService()

    const ws = getWorkspaceDir()
    // 业务数据（复用纯函数便于测试）
    clearBusinessData(ws, keepRuntime)
    // 配置：重建 app.json（恢复默认工作路径 + 未初始化）
    const configDir = path.join(ws, 'config')
    const defaultWs = path.join(getRootDir(), 'workspace')
    fs.mkdirSync(configDir, { recursive: true })
    fs.writeFileSync(path.join(configDir, 'app.json'), JSON.stringify({ workspacePath: defaultWs, onboarded: false }, null, 2), 'utf8')
    // 默认位置指针同步重置
    fs.mkdirSync(path.join(defaultWs, 'config'), { recursive: true })
    fs.writeFileSync(
      path.join(defaultWs, 'config', 'app.json'),
      JSON.stringify({ workspacePath: defaultWs, onboarded: false }, null, 2),
      'utf8'
    )
    // 日志清空
    for (const f of ['app.log', 'app.log.1', 'dsh.log']) {
      const p = path.join(ws, 'logs', f)
      if (fs.existsSync(p)) fs.writeFileSync(p, '', 'utf8')
    }
    logger.info(`应用已重置（保留运行环境：${keepRuntime}）`)
    return { ok: true, message: '已重置为初始状态' }
  } catch (error) {
    logger.error(`重置失败：${String(error)}`)
    return { ok: false, message: `重置失败：${error instanceof Error ? error.message : String(error)}` }
  }
}
