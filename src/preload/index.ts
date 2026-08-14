/**
 * preload — renderer 가 main 에 닿을 수 있는 **유일한 통로**.
 *
 * ⚠️ 이것이 이 앱의 신뢰 경계다. Tauri 에서는 `capabilities/default.json` 이
 * "여기 없는 것은 프론트가 할 수 없다" 를 강제했는데, Electron 에는 그런 선언이
 * 없으므로 **이 파일이 그 역할을 대신한다.**
 *
 * 규칙 (타협 불가):
 * 1. `ipcRenderer` 를 통째로 노출하지 않는다. 채널을 이름으로 받는 범용 함수
 *    (`invoke(channel, ...)`)도 만들지 않는다 — 그러면 화이트리스트가 무의미해진다.
 * 2. 노출하는 것은 `shared/types.ts` 의 `IPC` 에 정의된 채널을 부르는 **구체 함수**뿐이다.
 * 3. `fs`·`child_process` 같은 Node API 를 renderer 로 넘기지 않는다.
 * 4. 토큰·API 키를 돌려주는 함수를 만들지 않는다. renderer 는 "로그인했는가 · 누구인가" 만 안다.
 *
 * 이 원칙이 무너지면, LLM 응답 렌더링에서 스크립트 주입이 성공했을 때 그 스크립트가
 * 곧바로 사용자 컴퓨터에 도달한다. 일반 웹의 XSS 보다 심각도가 높다.
 */

import { contextBridge, ipcRenderer } from 'electron'
import { IPC, type FraiApi } from '../shared/types.js'

const api: FraiApi = {
  listProviders: () => ipcRenderer.invoke(IPC.listProviders),
  sendMessage: (request) => ipcRenderer.invoke(IPC.sendMessage, request),
  cancelSession: (sessionId) => ipcRenderer.invoke(IPC.cancelSession, sessionId),

  authStatus: () => ipcRenderer.invoke(IPC.authStatus),
  authSignIn: () => ipcRenderer.invoke(IPC.authSignIn),
  authSignOut: () => ipcRenderer.invoke(IPC.authSignOut),

  diagnostics: () => ipcRenderer.invoke(IPC.diagnostics),

  onSessionEvent: (handler) => {
    // ⚠️ 이벤트 객체(`_e`)는 renderer 로 넘기지 않는다 — `sender` 를 통해 IPC 표면이
    //    통째로 새어 나간다. payload 만 전달한다.
    const listener = (_e: unknown, payload: Parameters<typeof handler>[0]) => handler(payload)
    ipcRenderer.on(IPC.sessionEvent, listener)
    return () => ipcRenderer.removeListener(IPC.sessionEvent, listener)
  },

  onSetView: (handler) => {
    const listener = (_e: unknown, view: 'grid' | 'board') => handler(view)
    ipcRenderer.on(IPC.setView, listener)
    return () => ipcRenderer.removeListener(IPC.setView, listener)
  }
}

contextBridge.exposeInMainWorld('frai', api)
