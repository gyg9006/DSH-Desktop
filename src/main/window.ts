/**
 * 主窗口创建与窗口状态记忆（默认 1280×800，最小 1000×640）。
 * 窗口状态存入 <workspace>/config/window-state.json，随工作文件夹迁移。
 */
import { BrowserWindow, screen } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import { logger } from './logger'
import { getWindowStateFilePath } from './config'
import { readJsonFile, writeJsonAtomic } from '../shared/workspace'
import type { ThemeMode } from '../shared/ipc'

const DEFAULT_WIDTH = 1280
const DEFAULT_HEIGHT = 800
const MIN_WIDTH = 1000
const MIN_HEIGHT = 640

interface WindowState {
  x?: number
  y?: number
  width?: number
  height?: number
  maximized?: boolean
}

/** 最小化到托盘（规格 8.3）回调，由 index.ts 注入。 */
let onMinimizeToTray: (() => void) | null = null

export function setMinimizeToTrayHandler(handler: (() => void) | null): void {
  onMinimizeToTray = handler
}

let mainWindow: BrowserWindow | null = null

export function getMainWindow(): BrowserWindow | null {
  return mainWindow
}

function readWindowState(): WindowState {
  const raw = readJsonFile(getWindowStateFilePath())
  if (!raw || typeof raw !== 'object') return {}
  const state = raw as WindowState
  return {
    x: typeof state.x === 'number' ? state.x : undefined,
    y: typeof state.y === 'number' ? state.y : undefined,
    width: typeof state.width === 'number' ? state.width : undefined,
    height: typeof state.height === 'number' ? state.height : undefined,
    maximized: state.maximized === true
  }
}

function writeWindowState(state: WindowState): void {
  try {
    writeJsonAtomic(getWindowStateFilePath(), state)
  } catch (error) {
    logger.warn(`窗口状态保存失败：${String(error)}`)
  }
}

/** 校验记忆的窗口位置仍落在某个显示器可视区域内（防止换机后窗口丢失）。 */
function isStateVisible(state: WindowState): boolean {
  if (state.x === undefined || state.y === undefined || state.width === undefined || state.height === undefined) {
    return false
  }
  return screen.getAllDisplays().some((display) => {
    const area = display.workArea
    return (
      state.x! >= area.x - 50 &&
      state.y! >= area.y - 50 &&
      state.x! + state.width! <= area.x + area.width + 50 &&
      state.y! + state.height! <= area.y + area.height + 50
    )
  })
}

function backgroundColorFor(theme: ThemeMode): string {
  if (theme === 'dark') return '#141414'
  if (theme === 'light') return '#f5f6f8'
  return '#f5f6f8'
}

export function createMainWindow(workspaceDir: string, theme: ThemeMode): BrowserWindow {
  const saved = readWindowState()
  const bounds = isStateVisible(saved)
    ? { x: saved.x, y: saved.y, width: saved.width!, height: saved.height! }
    : { width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT }

  const iconPath = path.join(workspaceDir, '..', 'resources', 'icon.png')
  const win = new BrowserWindow({
    ...bounds,
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
    show: false,
    backgroundColor: backgroundColorFor(theme),
    autoHideMenuBar: true,
    title: 'DSH 桌面',
    icon: fs.existsSync(iconPath) ? iconPath : undefined,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      webviewTag: true
    }
  })

  mainWindow = win

  win.on('ready-to-show', () => {
    win.show()
    if (saved.maximized) win.maximize()
  })

  // 窗口状态记忆（防抖 500ms）
  let saveTimer: NodeJS.Timeout | null = null
  const scheduleSave = (): void => {
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      const maximized = win.isMaximized()
      const normal = win.getNormalBounds()
      writeWindowState({
        x: maximized ? normal.x : win.getBounds().x,
        y: maximized ? normal.y : win.getBounds().y,
        width: maximized ? normal.width : win.getBounds().width,
        height: maximized ? normal.height : win.getBounds().height,
        maximized
      })
    }, 500)
  }
  win.on('resize', scheduleSave)
  win.on('move', scheduleSave)

  // 最小化到托盘（规格 8.3）
  win.on('minimize', () => {
    if (onMinimizeToTray) {
      onMinimizeToTray()
      win.hide()
    }
  })
  win.on('close', () => {
    if (saveTimer) clearTimeout(saveTimer)
    try {
      writeWindowState({
        x: win.getBounds().x,
        y: win.getBounds().y,
        width: win.getBounds().width,
        height: win.getBounds().height,
        maximized: win.isMaximized()
      })
    } catch (error) {
      logger.warn(`窗口状态保存失败：${String(error)}`)
    }
  })

  win.on('closed', () => {
    mainWindow = null
  })

  // 开发模式 F12 开关开发者工具
  if (!appIsPackaged()) {
    win.webContents.on('before-input-event', (_event, input) => {
      if (input.type === 'keyDown' && input.key === 'F12') {
        win.webContents.toggleDevTools()
      }
    })
  }

  // 加载渲染层
  if (process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void win.loadFile(path.join(__dirname, '../renderer/index.html'))
  }

  win.webContents.on('did-fail-load', (_event, errorCode, errorDescription) => {
    logger.error(`页面加载失败：${errorCode} ${errorDescription}`)
  })

  return win
}

function appIsPackaged(): boolean {
  // 避免循环依赖：此处不 import electron 的 app，改用 process.env
  return !process.env['ELECTRON_RENDERER_URL']
}
