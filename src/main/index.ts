/**
 * 앱 조립 — 창 · 보안 정책 · 메뉴 · IPC · 종료 정리.
 *
 * ⚠️ `electron` 을 import 하는 것은 이 파일과 `ipc.ts` · `auth/store.ts` 뿐이다.
 *    나머지 main 로직(`events` · `session` · `provider` · `auth`)은 electron 을
 *    모르기 때문에 창을 띄우지 않고 그대로 테스트된다. 이 경계를 깨지 말 것.
 */

import { app, BrowserWindow, Menu, session as electronSession, shell } from 'electron'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Auth } from './auth/index.js'
import { createSessionStore } from './auth/store.js'
import { registerIpc } from './ipc.js'
import { SessionManager } from './session.js'
import { cspFor, DEV_URL as DEFAULT_DEV_URL } from '../shared/csp.js'
import { IPC } from '../shared/types.js'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const isDev = !app.isPackaged
const DEV_URL = process.env.FRAI_DEV_URL ?? DEFAULT_DEV_URL

/**
 * 릴레이(기본 AI) 엔드포인트.
 *
 * 기본값은 프로덕션이고, `FRAI_RELAY_URL` 로 로컬 서버를 가리킬 수 있다.
 * **릴레이 서버를 개발할 때 이것이 없으면 앱이 항상 프로덕션을 때린다** — 서버를
 * 고쳐도 시험할 방법이 없어진다(Tauri 판에는 있던 기능이라 이식 누락이었다).
 */
const RELAY_URL = process.env.FRAI_RELAY_URL?.trim() || undefined

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    show: false,
    // Tauri 의 titleBarStyle: "Transparent" + hiddenTitle 에 대응한다.
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      // 🛑 아래 두 줄은 이 앱의 보안 근간이다. 절대 바꾸지 말 것.
      //    renderer 에서 Node API 를 직접 쓸 수 있게 되면 preload 화이트리스트가
      //    무의미해지고, LLM 응답을 통한 스크립트 주입이 곧바로 파일 접근이 된다.
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false // preload 에서 node:* 를 쓰지 않으므로 true 도 가능하나, 확장 여지를 남긴다
    }
  })

  win.once('ready-to-show', () => win.show())

  // 새 창·외부 링크는 앱 안에서 열지 않고 시스템 브라우저로 보낸다.
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })
  // 앱 화면이 외부 사이트로 이동하는 것을 막는다(피싱·권한 탈취 방지).
  win.webContents.on('will-navigate', (e, url) => {
    const allowed = isDev && url.startsWith(DEV_URL)
    if (!allowed) {
      e.preventDefault()
      void shell.openExternal(url)
    }
  })

  if (isDev) void win.loadURL(DEV_URL)
  else void win.loadFile(join(__dirname, '../renderer/index.html'))

  return win
}

function buildMenu(getWindow: () => BrowserWindow | null): void {
  const send = (view: 'grid' | 'board') => getWindow()?.webContents.send(IPC.setView, view)

  const template: Electron.MenuItemConstructorOptions[] = [
    ...(process.platform === 'darwin'
      ? [{ role: 'appMenu' as const }]
      : []),
    { role: 'editMenu' },
    {
      label: '보기',
      submenu: [
        { label: '바둑판', accelerator: 'CmdOrCtrl+1', click: () => send('grid') },
        { label: '세션 목록', accelerator: 'CmdOrCtrl+2', click: () => send('board') },
        { type: 'separator' },
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    { role: 'windowMenu' }
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

let mainWindow: BrowserWindow | null = null

// 두 인스턴스가 동시에 뜨면 기기 ID·세션 파일을 두고 경합한다.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  void app.whenReady().then(() => {
    electronSession.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [cspFor({ dev: isDev, devUrl: DEV_URL })]
        }
      })
    })

    const userData = app.getPath('userData')
    const auth = new Auth({
      store: createSessionStore(join(userData, 'session.bin')),
      openExternal: (url) => shell.openExternal(url)
    })
    const sessions = new SessionManager({
      endpoint: RELAY_URL,
      deviceIdPath: join(userData, 'device-id'),
      appVersion: app.getVersion(),
      bearer: () => auth.bearer()
    })
    if (RELAY_URL) console.info(`릴레이 엔드포인트 재지정: ${RELAY_URL}`)

    registerIpc({ sessions, auth, getWindow: () => mainWindow })

    mainWindow = createWindow()
    buildMenu(() => mainWindow)

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow()
    })

    // 앱이 끝나면 남은 세션(자식 프로세스·연결)을 전부 정리한다.
    app.on('before-quit', () => sessions.cancelAll())
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
