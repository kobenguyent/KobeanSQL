import { app, BrowserWindow, shell, nativeTheme } from 'electron'
import path from 'path'
import { ConnectionManager } from './db/manager'
import { registerIpcHandlers } from './ipc'
import { is } from '@electron-toolkit/utils'
import { appLogger, setupLogger } from './logger'
import { isSafeExternalUrl, isTrustedRendererUrl } from './security'
import { createUpdateService } from './update/service'
import { localStore } from './local-store'
import {performMigrations} from "./store";

// Configure logger
setupLogger()
appLogger.info('KobeanSQL starting...')

const manager = new ConnectionManager()
const updateService = createUpdateService()

function createWindow(): BrowserWindow {
  const iconPath = path.join(app.getAppPath(), 'build/icon.png')
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: 'KobeanSQL',
    icon: iconPath,
    // macOS vibrancy / transparency
    vibrancy: 'under-window',
    visualEffectState: 'active',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
    backgroundColor: '#00000000',
    backgroundMaterial: 'acrylic', // Windows 11 acrylic
    transparent: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      sandbox: true,
      nodeIntegration: false,
      contextIsolation: true
    }
  })

  // Force dark mode
  nativeTheme.themeSource = 'dark'

  win.on('ready-to-show', () => {
    win.show()
  })

  // Open external links in default browser
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternalUrl(url)) {
      void shell.openExternal(url).catch((error) => {
        appLogger.warn('Failed to open external URL', { url, error: (error as Error).message })
      })
    } else {
      appLogger.warn('Blocked unsafe external URL', { url })
    }
    return { action: 'deny' }
  })

  win.webContents.on('will-navigate', (event, url) => {
    if (!isTrustedRendererUrl(url)) {
      event.preventDefault()
      appLogger.warn('Blocked navigation to untrusted URL', { url })
    }
  })

  // Load the app
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
    win.webContents.openDevTools({ mode: 'detach' })
  } else {
    win.loadFile(path.join(__dirname, '../renderer/index.html'))
  }

  return win
}

app.whenReady().then(async () => {
  appLogger.info('Application ready')

  // Support overriding userData via --user-data-dir for E2E tests
  const userDataArg = process.argv.find((arg) => arg.startsWith('--user-data-dir='))
  if (userDataArg) {
    const customPath = userDataArg.split('=')[1]
    if (customPath) {
      app.setPath('userData', path.resolve(customPath))
    }
  }

  await performMigrations()
  await localStore.open(app.getPath('userData'))
  registerIpcHandlers(manager, updateService)
  createWindow()
  updateService.initialize()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', async () => {
  appLogger.info('All windows closed, disconnecting all connections')
  await manager.disconnectAll()
  localStore.close()
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', async () => {
  appLogger.info('App before-quit, disconnecting all connections')
  await manager.disconnectAll()
  localStore.close()
})
