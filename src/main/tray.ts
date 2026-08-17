/**
 * M5：系统托盘（规格 8.3）。
 * 最小化到托盘；菜单：显示主窗口 / 启动服务 / 停止服务 / 退出；
 * --background 模式（开机自启）：不弹主窗口，仅托盘 + 自动启动服务（规格 6.14）。
 */
import { app, Tray, Menu, nativeImage, BrowserWindow, type MenuItemConstructorOptions } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { logger } from './logger'
import { startDshService, stopDshService, getServiceSnapshot } from './dshService'

let tray: Tray | null = null
let trayIconOverride: string | null = null

function trayIconPath(): string {
  // 主题提供 tray-icon.png 时优先；否则使用应用内置图标
  if (trayIconOverride && fs.existsSync(trayIconOverride)) return trayIconOverride
  // 打包后 resources/ 位于 asar 根；开发时为项目 resources/
  return path.join(app.getAppPath(), 'resources', 'icon.png')
}

/** 主题切换时替换托盘图标（无自定义图标则回退默认）。 */
export function refreshTrayTheme(iconPath: string | undefined): void {
  trayIconOverride = iconPath ?? null
  if (!tray) return
  try {
    const icon = nativeImage.createFromPath(trayIconPath()).resize({ width: 16, height: 16 })
    tray.setImage(icon.isEmpty() ? nativeImage.createEmpty() : icon)
  } catch (error) {
    logger.warn(`托盘图标更新失败：${String(error)}`)
  }
}

function buildMenu(getWindow: () => BrowserWindow | null): Menu {
  const snapshot = getServiceSnapshot()
  const running = snapshot.status === 'running' || snapshot.status === 'starting'
  const template: MenuItemConstructorOptions[] = [
    { label: '显示主窗口', click: () => getWindow()?.show() },
    { type: 'separator' },
    {
      label: running ? `停止服务${snapshot.port ? `（端口 ${snapshot.port}）` : ''}` : '启动服务',
      enabled: true,
      click: () => {
        if (running) void stopDshService()
        else void startDshService()
      }
    },
    { type: 'separator' },
    { label: '退出', click: () => app.quit() }
  ]
  return Menu.buildFromTemplate(template)
}

export function ensureTray(getWindow: () => BrowserWindow | null): void {
  if (tray) return
  try {
    const icon = nativeImage.createFromPath(trayIconPath()).resize({ width: 16, height: 16 })
    tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon)
    tray.setToolTip('DSH 桌面')
    tray.setContextMenu(buildMenu(getWindow))
    tray.on('click', () => {
      const win = getWindow()
      if (win) {
        if (win.isMinimized()) win.restore()
        win.show()
        win.focus()
      }
    })
    logger.info('系统托盘已创建')
  } catch (error) {
    logger.warn(`托盘创建失败：${String(error)}`)
  }
}

/** 服务状态变化时刷新托盘菜单。 */
export function refreshTrayMenu(getWindow: () => BrowserWindow | null): void {
  if (tray) tray.setContextMenu(buildMenu(getWindow))
}

export function destroyTray(): void {
  tray?.destroy()
  tray = null
}
