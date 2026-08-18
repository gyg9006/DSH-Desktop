/**
 * 主进程入口：
 * - 单实例锁；
 * - 全局错误边界（未捕获异常写日志，禁止静默崩溃）；
 * - 运行时初始化（工作文件夹 + userData 重定向 + 日志）；
 * - 全局快捷键（Ctrl+B 任务栏 / Ctrl+N 新建对话 / Ctrl+, 设置）；
 * - 创建主窗口。
 */
import { app, dialog, globalShortcut, Menu } from 'electron'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { initializeRuntime, getWorkspaceDir, getEffectiveTheme, redirectUserDataPaths, readAppConfig } from './config'
import { logger } from './logger'
import { createMainWindow, getMainWindow } from './window'
import { registerIpcHandlers, broadcastUiEvent } from './ipc'
import { stopDshService, isServiceRunning, startDshService, onServiceStatusChange } from './dshService'
import { ensureTray, refreshTrayMenu } from './tray'
import { scheduleAutoBackup } from './backup'
import { scheduleAutoUpdate, stopAutoUpdateSchedule } from './updater'
import { scheduleAutoSync, stopAutoSyncSchedule } from './smartSync'
import { syncNativeThemeFromActive } from './theme'
import { syncModelsConfigToDsh, syncKeysToCredentials } from './modelsDshSync'
import { hasBundledEnv } from './env-resolver'

app.setName('DSH-Desktop')
app.setAppUserModelId('com.dshworkbench.app')

/** 开机自启后台模式（规格 6.14：仅后台服务 + 托盘，不弹主窗口） */
const BACKGROUND_MODE = process.argv.includes('--background')

// 必须在 ready 之前（且在单实例锁之前）重定向数据路径，
// 否则 %APPDATA% 会出现残留（规格 9.3）
redirectUserDataPaths()

// 单实例：重复启动时聚焦已有窗口。
// 锁失败可能来自：① 另一实例在跑（正常 → 聚焦后退出）；② 锁残留（上次强杀/异常退出，
// Electron SingletonLock 未清理）→ 无其他实例时清理锁后重试一次，避免「启动即退」。
function acquireSingleInstanceLock(): boolean {
  if (app.requestSingleInstanceLock()) return true
  try {
    const me = process.pid
    const list = spawnSync(
      'tasklist',
      ['/FI', 'IMAGENAME eq DSH-Desktop.exe', '/FO', 'CSV', '/NH'],
      { encoding: 'utf8', timeout: 15000, windowsHide: true }
    )
    const hasOther = String(list.stdout ?? '')
      .split(/\r?\n/)
      .filter((l) => /DSH-Desktop\.exe/i.test(l))
      .some((l) => !new RegExp(`"${me}"`).test(l))
    if (hasOther) return false // 确有另一实例在跑 → 退出（聚焦由 second-instance 处理）
    // 无其他实例：锁残留 → 清理后重试一次
    const ud = app.getPath('userData')
    for (const f of ['SingletonLock', 'SingletonCookie', 'SingletonSocket']) {
      try {
        fs.rmSync(path.join(ud, f), { force: true })
      } catch {
        /* 忽略 */
      }
    }
    return app.requestSingleInstanceLock()
  } catch {
    return false
  }
}

const gotLock = acquireSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const win = getMainWindow()
    if (win) {
      if (win.isMinimized()) win.restore()
      win.show()
      win.focus()
    }
  })

  // 全局错误边界
  process.on('uncaughtException', (error) => {
    logger.error(`主进程未捕获异常：${error?.stack ?? String(error)}`)
    const win = getMainWindow()
    if (win && !win.isDestroyed()) {
      dialog
        .showMessageBox(win, {
          type: 'error',
          title: 'DSH-Desktop 遇到问题',
          message: '主进程发生未捕获异常，详细信息已写入工作文件夹的日志。',
          detail: String(error?.message ?? error),
          buttons: ['确定']
        })
        .catch(() => undefined)
    }
  })

  process.on('unhandledRejection', (reason) => {
    logger.error(`主进程未处理的 Promise 拒绝：${String(reason)}`)
  })

  app.whenReady().then(() => {
    Menu.setApplicationMenu(null)

    const workspaceDir = initializeRuntime()
    logger.info(`应用启动 v${app.getVersion()}，打包模式：${app.isPackaged ? '是' : '否'}${BACKGROUND_MODE ? '，后台模式' : ''}`)

    // P3：环境解析（内置/工作区/系统三级），检测面板与一键安装共用
    try {
      logger.info(`环境解析就绪（内置便携环境：${hasBundledEnv() ? '可用' : '无'}）`)
    } catch (error) {
      logger.warn(`环境解析检查失败：${String(error)}`)
    }

    // 主题全局化：启动时同步 nativeTheme（暗/亮随激活主题）
    syncNativeThemeFromActive(workspaceDir)
    // 模型配置同步 dsh：启动即保证对话模型选择器有可选模型（服务启动前执行，幂等）
    try {
      syncModelsConfigToDsh(workspaceDir)
      syncKeysToCredentials(workspaceDir)
    } catch (error) {
      logger.warn(`模型配置同步失败：${String(error)}`)
    }

    registerIpcHandlers()
    registerGlobalShortcuts()
    // 托盘取窗口时若已被销毁则重建（规格 8.3：托盘可随时恢复主窗口）
    ensureTray(() => {
      let win = getMainWindow()
      if (!win || win.isDestroyed()) {
        createMainWindow(getWorkspaceDir(), getEffectiveTheme())
        win = getMainWindow()
      }
      return win
    })

    if (BACKGROUND_MODE) {
      // 后台模式：不创建主窗口，自动启动 dsh 服务（规格 6.14）
      const config = readAppConfig()
      if ((config.service as { autoStart?: boolean } | undefined)?.autoStart) {
        void startDshService().then((result) => {
          if (!result.ok) logger.warn(`后台自动启动失败：${result.error ?? ''}`)
        })
      }
      return
    }

    const theme = getEffectiveTheme()
    createMainWindow(workspaceDir, theme)

    // 关闭窗口 = 正常关闭 → window-all-closed → app.quit()（不再隐藏到托盘驻留）
    // 自动备份调度（规格 6.22）
    scheduleAutoBackup(workspaceDir)

    // 版本更新调度（auto 模式：启动 10 秒后 + 每 6 小时检查）
    scheduleAutoUpdate()

    // 智能同步自动调度（sync.json smart.autoSyncMinutes > 0 时生效；完成后广播 UI 事件）
    scheduleAutoSync((message) => {
      broadcastUiEvent('sync-completed')
      logger.info(message)
    }, workspaceDir)

    app.on('activate', () => {
      if (!getMainWindow()) createMainWindow(getWorkspaceDir(), getEffectiveTheme())
    })
  })

  // 服务状态变化时同步托盘菜单
  onServiceStatusChange(() => {
    refreshTrayMenu(() => getMainWindow())
  })

  // 退出时优雅关闭 dsh 服务；5 秒超时兜底强制退出，
  // 避免 stopDshService 卡住导致应用无法退出、残留 electron 进程
  let quitting = false

  app.on('window-all-closed', () => {
    logger.info('window-all-closed → 退出应用')
    app.quit()
  })

  app.on('before-quit', (event) => {
    logger.info(`before-quit（quitting=${quitting}）`)
    if (quitting) return
    event.preventDefault()
    quitting = true
    const forceTimer = setTimeout(() => {
      logger.warn('退出超时（5 秒），强制结束进程')
      app.exit(0)
    }, 5000)
    const finish = (): void => {
      clearTimeout(forceTimer)
      app.exit(0)
    }
    if (isServiceRunning()) {
      void stopDshService()
        .catch((error) => logger.warn(`停止服务失败：${String(error)}`))
        .finally(finish)
    } else {
      finish()
    }
  })

  app.on('will-quit', () => {
    stopAutoUpdateSchedule()
    stopAutoSyncSchedule()
    globalShortcut.unregisterAll()
    logger.info('应用退出')
  })
}

function registerGlobalShortcuts(): void {
  const send = (type: Parameters<typeof broadcastUiEvent>[0]): void => broadcastUiEvent(type)
  try {
    globalShortcut.register('CommandOrControl+B', () => send('toggle-sidebar'))
    globalShortcut.register('CommandOrControl+N', () => send('new-chat'))
    globalShortcut.register('CommandOrControl+,', () => send('open-settings'))
  } catch (error) {
    logger.warn(`全局快捷键注册失败：${String(error)}`)
  }
}

