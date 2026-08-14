/**
 * IPC 계약 검증 — preload 와 main 이 **같은 채널 이름을 말하는지** 확인한다.
 *
 * ⚠️ 왜 필요한가: 이 앱의 renderer 테스트는 `window.frai` 를 목으로 대체하므로,
 * preload 가 실제로 어떤 채널을 부르는지도, main 이 그 채널을 등록했는지도 보지 못한다.
 * 즉 채널 이름이 한쪽만 바뀌어도 **테스트는 전부 초록인 채로 앱이 죽는다**
 * (renderer 는 `undefined` 를 받고, 그 오류는 실행해 봐야 보인다).
 *
 * 여기서는 `electron` 을 목으로 갈아끼워 preload 와 ipc 를 **실제로 로드**하고
 * 양쪽 채널 집합을 맞춰 본다. 창은 뜨지 않는다.
 */

import { beforeAll, describe, expect, it, vi } from 'vitest'
import { IPC, type FraiApi } from '../shared/types.js'

/** preload 가 부른 invoke 채널. */
const invoked: string[] = []
/** preload 가 붙인 이벤트 리스너 채널. */
const listened: string[] = []
/** main 이 등록한 handle 채널. */
const handled: string[] = []
/** contextBridge 로 노출된 것. */
const exposed: Record<string, unknown> = {}

vi.mock('electron', () => ({
  contextBridge: {
    exposeInMainWorld: (key: string, value: unknown) => {
      exposed[key] = value
    }
  },
  ipcRenderer: {
    invoke: (channel: string) => {
      invoked.push(channel)
      return Promise.resolve(null)
    },
    on: (channel: string) => {
      listened.push(channel)
    },
    removeListener: () => {}
  },
  ipcMain: {
    handle: (channel: string) => {
      handled.push(channel)
    }
  },
  app: { getVersion: () => '0.0.0-test', getPath: () => '/tmp' },
  safeStorage: { isEncryptionAvailable: () => false }
}))

let api: FraiApi

beforeAll(async () => {
  await import('../preload/index.js')
  api = exposed.frai as FraiApi

  const { registerIpc } = await import('./ipc.js')
  registerIpc({
    sessions: { start: () => {}, cancel: () => {} } as never,
    auth: { status: () => null, signIn: () => null, signOut: () => null } as never,
    getWindow: () => null
  })
})

describe('preload — 신뢰 경계', () => {
  it('`frai` 하나만 노출한다', () => {
    expect(Object.keys(exposed)).toEqual(['frai'])
  })

  /**
   * 🛑 이것이 뚫리면 화이트리스트가 무의미해진다. LLM 응답으로 주입된 스크립트가
   * 임의 채널을 부를 수 있게 되기 때문이다.
   */
  it('ipcRenderer 자체나 범용 invoke 를 노출하지 않는다', () => {
    const keys = Object.keys(api)
    expect(keys).not.toContain('invoke')
    expect(keys).not.toContain('send')
    expect(keys).not.toContain('ipcRenderer')
    // 노출된 값은 전부 함수여야 한다(객체를 통째로 넘기면 그 안이 표면이 된다).
    for (const [k, v] of Object.entries(api)) expect(typeof v, k).toBe('function')
  })

  it('토큰·API 키를 돌려주는 함수가 없다', () => {
    for (const k of Object.keys(api)) expect(k).not.toMatch(/token|secret|key/i)
  })
})

describe('채널 계약 — preload ↔ main', () => {
  it('preload 가 부르는 invoke 채널을 main 이 전부 등록한다', async () => {
    invoked.length = 0
    // 인자는 중요하지 않다. 어떤 채널을 부르는지만 본다.
    await api.listProviders()
    await api.sendMessage({ sessionId: 's', provider: 'p', messages: [] })
    await api.cancelSession('s')
    await api.authStatus()
    await api.authSignIn()
    await api.authSignOut()
    await api.diagnostics()

    expect(invoked).toEqual([
      IPC.listProviders,
      IPC.sendMessage,
      IPC.cancelSession,
      IPC.authStatus,
      IPC.authSignIn,
      IPC.authSignOut,
      IPC.diagnostics
    ])
    // 하나라도 빠지면 renderer 가 조용히 undefined 를 받는다.
    for (const channel of invoked) expect(handled, channel).toContain(channel)
  })

  it('main 이 등록한 채널 중 preload 가 못 부르는 것은 없다', () => {
    // 반대 방향도 본다 — 아무도 못 부르는 핸들러는 죽은 표면이다.
    for (const channel of handled) expect(invoked, channel).toContain(channel)
  })

  it('main→renderer 이벤트 채널도 일치한다', () => {
    listened.length = 0
    api.onSessionEvent(() => {})
    api.onSetView(() => {})
    expect(listened).toEqual([IPC.sessionEvent, IPC.setView])
  })

  it('IPC 상수에 정의된 채널이 전부 쓰인다', () => {
    const used = new Set([...invoked, ...listened])
    for (const channel of Object.values(IPC)) expect(used, channel).toContain(channel)
  })
})
