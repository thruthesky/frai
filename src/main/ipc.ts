/**
 * IPC 핸들러 등록 — renderer 가 부를 수 있는 것 전부.
 *
 * ⚠️ 최소 권한 원칙: **여기 없는 것은 renderer 가 할 수 없다.**
 *    특히 임의 명령 실행이나 임의 경로 파일 접근을 받는 핸들러를 만들지 않는다.
 *    CLI 실행은 `CLI_SPECS` 허용 목록을 통해서만 이뤄진다.
 *    (Tauri `commands.rs` 의 머리말 원칙을 그대로 이어받는다.)
 *
 * ⚠️ 세션 토큰을 반환하는 핸들러를 만들지 않는다. renderer 에는 "로그인했는가",
 *    "누구인가" 만 알려준다. 토큰은 저장소와 main 안에서만 돈다.
 */

import { ipcMain, type BrowserWindow } from 'electron'
import type { Auth } from './auth/index.js'
import { userPath } from './provider/detect.js'
import { listProviders } from './provider/index.js'
import type { SessionManager } from './session.js'
import { IPC, type ChatRequest, type SessionEvent } from '../shared/types.js'

export interface IpcDeps {
  sessions: SessionManager
  auth: Auth
  getWindow: () => BrowserWindow | null
}

export function registerIpc(deps: IpcDeps): void {
  const { sessions, auth, getWindow } = deps

  ipcMain.handle(IPC.listProviders, () => listProviders())

  ipcMain.handle(IPC.sendMessage, (_e, request: ChatRequest) => {
    // 세션 이벤트는 반환값이 아니라 창으로 흘려보낸다.
    const emit = (ev: SessionEvent) => {
      const win = getWindow()
      // 창이 이미 닫혔을 수 있다 — 치명적이지 않다.
      if (win && !win.isDestroyed()) win.webContents.send(IPC.sessionEvent, ev)
    }
    sessions.start(request, emit)
  })

  ipcMain.handle(IPC.cancelSession, (_e, sessionId: string) => {
    sessions.cancel(sessionId)
  })

  ipcMain.handle(IPC.authStatus, () => auth.status())
  ipcMain.handle(IPC.authSignIn, () => auth.signIn())
  ipcMain.handle(IPC.authSignOut, () => auth.signOut())

  /**
   * 진단용 — 로그인 셸에서 확보한 PATH 를 그대로 보여준다.
   * 패키징된 앱에서 CLI 를 못 찾을 때 원인 파악에 쓴다.
   */
  ipcMain.handle(IPC.diagnostics, async () => ({
    path: await userPath(),
    shell: process.env.SHELL ?? ''
  }))
}
