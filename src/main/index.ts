/**
 * 앱 조립 — 창 · 보안 정책 · 메뉴 · IPC · 종료 정리.
 *
 * ⚠️ `electron` 을 import 하는 것은 이 파일과 `ipc.ts` · `auth/store.ts` 뿐이다.
 *    나머지 main 로직(`events` · `session` · `provider` · `auth`)은 electron 을
 *    모르기 때문에 창을 띄우지 않고 그대로 테스트된다. 이 경계를 깨지 말 것.
 */

import { app, BrowserWindow, dialog, Menu, session as electronSession, shell } from 'electron'
import updaterPkg from 'electron-updater'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Auth } from './auth/index.js'
import { createSessionStore } from './auth/store.js'
import { registerIpc } from './ipc.js'
import { SessionManager } from './session.js'
import { setupAutoUpdate, type UpdaterHandle } from './updater.js'
import { cspFor, DEV_URL as DEFAULT_DEV_URL } from '../shared/csp.js'
import { IPC } from '../shared/types.js'

/**
 * ⚠️ `new URL('.', import.meta.url)` 을 쓰지 말 것.
 *
 * Vite 는 그 패턴을 **에셋 참조로 특별 취급**한다. 첫 인자 `'.'` 을 번들할 파일로 오인해
 * 소스 전체를 `data:` URL 로 인라인해 버리고, 그러면 `fileURLToPath` 가
 * `ERR_INVALID_URL_SCHEME: The URL must be of scheme file` 로 죽는다 — **빌드는 성공하고
 * 앱을 띄우는 순간에만 터진다**(2026-08-22 실측). 타입 검사·유닛 테스트로는 잡히지 않아
 * `scripts/smoke-main.mjs` 가 실제 로드를 검사한다.
 */
const __dirname = dirname(fileURLToPath(import.meta.url))
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

/**
 * 스모크 모드 — **창을 띄우지 않고** main 이 끝까지 살아 오르는지만 확인한다.
 *
 * 왜 필요한가: 타입 검사도 유닛 테스트도 **번들을 실제로 로드하지 않는다.** 그래서
 * "빌드는 성공하는데 앱을 켜면 죽는" 종류의 결함(모듈 최상단 예외, 잘못된 경로 해석,
 * 번들러의 변환 사고)을 하나도 잡지 못한다 — 실제로 그렇게 배포한 적이 있다.
 *
 * `scripts/smoke-main.mjs` 가 이 환경변수를 켜고 Electron 을 띄운다. 창 생성만 건너뛰고
 * IPC 등록·메뉴·업데이터 배선까지 전부 실행하므로, 그 경로의 예외도 함께 잡힌다.
 */
const SMOKE = process.env.FRAI_SMOKE_EXIT === '1'

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
  const isMac = process.platform === 'darwin'

  // 자동 확인과 별개로 **사람이 직접 확인할 수단**을 둔다. 자동 업데이트는 조용히
  // 도는 기능이라, 눌러서 결과를 볼 수 없으면 되는지 안 되는지 알 방법이 없다.
  const checkUpdate: Electron.MenuItemConstructorOptions = {
    label: '업데이트 확인…',
    click: () => void updater?.check()
  }

  const template: Electron.MenuItemConstructorOptions[] = [
    // macOS 는 관례대로 앱 메뉴에 둔다. `role: 'appMenu'` 를 쓰면 항목을 끼울 수 없어
    // 기본 구성을 그대로 펼쳐 쓴다.
    ...(isMac
      ? ([
          {
            label: app.name,
            submenu: [
              { role: 'about' },
              checkUpdate,
              { type: 'separator' },
              { role: 'services' },
              { type: 'separator' },
              { role: 'hide' },
              { role: 'hideOthers' },
              { role: 'unhide' },
              { type: 'separator' },
              { role: 'quit' }
            ]
          }
        ] as Electron.MenuItemConstructorOptions[])
      : []),
    { role: 'editMenu' },
    {
      label: '보기',
      submenu: [
        { label: '바둑판', accelerator: 'CmdOrCtrl+1', click: () => send('grid') },
        { label: '세션 목록', accelerator: 'CmdOrCtrl+2', click: () => send('board') },
        // Windows·Linux 에는 앱 메뉴가 없으므로 여기에 둔다.
        ...(isMac ? [] : ([{ type: 'separator' }, checkUpdate] as Electron.MenuItemConstructorOptions[])),
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
let updater: UpdaterHandle | null = null

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

  // 스모크에서는 Dock 아이콘도 띄우지 않는다 — 사람 화면을 조금도 건드리지 않는다.
  if (SMOKE && process.platform === 'darwin') app.dock?.hide()

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

    // 스모크는 창만 건너뛴다. 아래 메뉴·업데이터 배선은 그대로 실행해 그 경로의
    // 예외까지 잡는다.
    mainWindow = SMOKE ? null : createWindow()

    // 자동 업데이트. 정책은 `updater.ts` 에 있고 여기서는 실제 구현만 꽂는다.
    updater = setupAutoUpdate({
      updater: updaterPkg.autoUpdater,
      isPackaged: app.isPackaged,
      // ⚠️ 진행 중인 세션이 있으면 재시작을 제안하지 않는다 — 몇 분씩 걸리는 AI 작업이
      //    통째로 날아간다. 앱을 끌 때 자동으로 적용되므로 재촉할 이유가 없다.
      runningSessions: () => sessions.runningCount,
      promptRestart: async (version) => {
        const { response } = await dialog.showMessageBox({
          type: 'info',
          buttons: ['지금 재시작', '나중에'],
          defaultId: 0,
          cancelId: 1,
          message: `FRAI ${version} 을 내려받았습니다.`,
          detail: '지금 재시작하면 바로 적용됩니다. 나중을 고르면 앱을 끌 때 자동으로 적용됩니다.'
        })
        return response === 0
      }
    })

    buildMenu(() => mainWindow)

    if (SMOKE) {
      // 이 줄이 찍혔다는 것은 모듈 로드부터 IPC·메뉴·업데이터 배선까지 전부 통과했다는 뜻이다.
      console.info('[smoke] main 초기화 성공')
      app.quit()
      return
    }

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow()
    })

    // 앱이 끝나면 남은 세션(자식 프로세스·연결)을 전부 정리한다.
    app.on('before-quit', () => {
      sessions.cancelAll()
      updater?.stop()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
