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
import { IPC } from '../shared/types.js'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const isDev = !app.isPackaged
const DEV_URL = process.env.FRAI_DEV_URL ?? 'http://localhost:1420'

/**
 * 콘텐츠 보안 정책.
 *
 * Tauri 는 `tauri.conf.json` 에 적으면 자동으로 주입해 줬지만 Electron 은 아무것도
 * 해 주지 않는다 — **여기서 직접 넣지 않으면 CSP 가 통째로 없는 앱이 된다.**
 * 이 앱은 외부(LLM)에서 온 텍스트를 화면에 그리므로, 스크립트 주입이 성공하면
 * 그 스크립트가 preload 를 통해 main 에 도달할 수 있다. 일반 웹의 XSS 보다 심각하다.
 *
 * `unsafe-inline` 은 style 에만 허용한다(Svelte 가 스타일을 인라인으로 넣는다).
 * script 에는 절대 넣지 않는다 — Svelte 를 컴파일해 쓰는 이유 중 하나가 이것이다.
 */
function cspFor(dev: boolean): string {
  const connect = dev
    ? `'self' ${DEV_URL} ws://localhost:1421 https://getpes.com`
    : `'self' https://getpes.com`
  return [
    "default-src 'self'",
    dev ? "script-src 'self' 'unsafe-inline'" : "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src ${connect}`,
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
    "form-action 'none'"
  ].join('; ')
}

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
          'Content-Security-Policy': [cspFor(isDev)]
        }
      })
    })

    const userData = app.getPath('userData')
    const auth = new Auth({
      store: createSessionStore(join(userData, 'session.bin')),
      openExternal: (url) => shell.openExternal(url)
    })
    const sessions = new SessionManager({
      deviceIdPath: join(userData, 'device-id'),
      appVersion: app.getVersion(),
      bearer: () => auth.bearer()
    })

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
