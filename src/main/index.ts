/**
 * 主进程入口：
 * - 单实例锁；
 * - 全局错误边界（未捕获异常写日志，禁止静默崩溃）；
 * - 运行时初始化（工作文件夹 + userData 重定向 + 日志）；
 * - 全局快捷键（Ctrl+B 任务栏 / Ctrl+N 新建对话 / Ctrl+, 设置）；
 * - 创建主窗口。
 */
import { app, dialog, globalShortcut, Menu } from 'electron'
import { initializeRuntime, getWorkspaceDir, getEffectiveTheme, redirectUserDataPaths, readAppConfig } from './config'
import { logger } from './logger'
import { createMainWindow, getMainWindow, setMinimizeToTrayHandler } from './window'
import { registerIpcHandlers, broadcastUiEvent } from './ipc'
import { stopDshService, isServiceRunning, startDshService, onServiceStatusChange } from './dshService'
import { ensureTray, refreshTrayMenu } from './tray'
import { scheduleAutoBackup } from './backup'

app.setName('DSH 桌面')
app.setAppUserModelId('com.dshworkbench.app')

/** 开机自启后台模式（规格 6.14：仅后台服务 + 托盘，不弹主窗口） */
const BACKGROUND_MODE = process.argv.includes('--background')

// 必须在 ready 之前（且在单实例锁之前）重定向数据路径，
// 否则 %APPDATA% 会出现残留（规格 9.3）
redirectUserDataPaths()

// 单实例：重复启动时聚焦已有窗口
const gotLock = app.requestSingleInstanceLock()
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
          title: 'DSH 桌面 遇到问题',
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

    registerIpcHandlers()
    registerGlobalShortcuts()
    ensureTray(() => getMainWindow())
    setMinimizeToTrayHandler(() => {
      // 已隐藏到托盘（ensureTray 已创建托盘；点击托盘图标可恢复）
      if (getMainWindow()) {
        // 通知渲染层（可选）
      }
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

    // 自动备份调度（规格 6.22）
    scheduleAutoBackup(workspaceDir)

    app.on('activate', () => {
      if (!getMainWindow()) createMainWindow(getWorkspaceDir(), getEffectiveTheme())
    })
  })

  // 服务状态变化时同步托盘菜单
  onServiceStatusChange(() => {
    refreshTrayMenu(() => getMainWindow())
  })

  app.on('window-all-closed', () => {
    app.quit()
  })

  // 退出时优雅关闭 dsh 服务（正常终止，宽限 3 秒后强制，规格 4.5）
  let quitting = false
  app.on('before-quit', (event) => {
    if (quitting || !isServiceRunning()) return
    event.preventDefault()
    quitting = true
    void stopDshService().finally(() => {
      app.exit(0)
    })
  })

  app.on('will-quit', () => {
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
