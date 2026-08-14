/**
 * 자동 업데이트 정책 검증 — 창도, 실제 업데이트 서버도 필요 없다.
 *
 * 자동 업데이트는 **평소에 아무 일도 일어나지 않는** 기능이라 눈으로 확인하기 가장 어렵다.
 * 그래서 "언제 확인하는가 · 언제 재시작을 제안하는가 · 실패하면 어떻게 되는가" 를 여기서 못박는다.
 */

import { describe, expect, it, vi } from 'vitest'
import { setupAutoUpdate, type UpdaterLike } from './updater.js'

type Listener = (...args: never[]) => void

/** `electron-updater` 의 autoUpdater 를 흉내 낸다. 이벤트를 직접 발사할 수 있다. */
function fakeUpdater() {
  const listeners = new Map<string, Listener[]>()
  const spy = {
    checkForUpdates: vi.fn(async () => ({})),
    quitAndInstall: vi.fn()
  }
  const updater: UpdaterLike = {
    autoDownload: false,
    autoInstallOnAppQuit: false,
    checkForUpdates: spy.checkForUpdates,
    quitAndInstall: spy.quitAndInstall,
    on(event, listener) {
      listeners.set(event, [...(listeners.get(event) ?? []), listener])
      return this
    }
  }
  const emit = (event: string, payload?: unknown) => {
    for (const l of listeners.get(event) ?? []) (l as (p?: unknown) => void)(payload)
  }
  return { updater, spy, emit }
}

const settle = () => new Promise((r) => setTimeout(r, 0))

describe('자동 업데이트 정책', () => {
  /**
   * ⚠️ 개발 모드에서 `checkForUpdates()` 를 부르면 `app-update.yml` 이 없어 즉시 실패한다.
   * 기능이 망가진 게 아니라 그 환경에 매니페스트가 없는 것이므로 아예 부르지 않는다.
   */
  it('개발 모드에서는 아무것도 확인하지 않는다', async () => {
    const { updater, spy } = fakeUpdater()
    setupAutoUpdate({
      updater,
      isPackaged: false,
      promptRestart: async () => true,
      runningSessions: () => 0
    })
    await settle()
    expect(spy.checkForUpdates).not.toHaveBeenCalled()
  })

  it('패키징된 앱은 시작하자마자 한 번 확인한다', async () => {
    const { updater, spy } = fakeUpdater()
    const h = setupAutoUpdate({
      updater,
      isPackaged: true,
      promptRestart: async () => false,
      runningSessions: () => 0
    })
    await settle()
    expect(spy.checkForUpdates).toHaveBeenCalledTimes(1)
    // 조용히 받아 두고 종료할 때 적용하는 조합이어야 한다.
    expect(updater.autoDownload).toBe(true)
    expect(updater.autoInstallOnAppQuit).toBe(true)
    h.stop()
  })

  /**
   * 🛑 이것이 이 모듈의 존재 이유다. FRAI 는 몇 분씩 걸리는 AI 세션을 여러 개 돌린다.
   * 그 와중에 재시작을 제안하면 진행 중인 작업이 통째로 날아간다.
   */
  it('세션이 돌고 있으면 재시작을 제안하지 않는다', async () => {
    const { updater, emit, spy } = fakeUpdater()
    const promptRestart = vi.fn(async () => true)
    const h = setupAutoUpdate({
      updater,
      isPackaged: true,
      promptRestart,
      runningSessions: () => 3 // 세 개가 돌고 있다
    })
    await settle()

    emit('update-downloaded', { version: '0.3.0' })
    await settle()

    expect(promptRestart).not.toHaveBeenCalled()
    expect(spy.quitAndInstall).not.toHaveBeenCalled()
    h.stop()
  })

  it('세션이 없을 때만 재시작을 제안하고, 수락하면 설치한다', async () => {
    const { updater, emit, spy } = fakeUpdater()
    const promptRestart = vi.fn(async () => true)
    const h = setupAutoUpdate({
      updater,
      isPackaged: true,
      promptRestart,
      runningSessions: () => 0
    })
    await settle()

    emit('update-downloaded', { version: '0.3.0' })
    await settle()

    expect(promptRestart).toHaveBeenCalledWith('0.3.0')
    expect(spy.quitAndInstall).toHaveBeenCalledTimes(1)
    h.stop()
  })

  it('나중에 를 고르면 설치하지 않는다 — 앱을 끌 때 알아서 적용된다', async () => {
    const { updater, emit, spy } = fakeUpdater()
    const h = setupAutoUpdate({
      updater,
      isPackaged: true,
      promptRestart: async () => false,
      runningSessions: () => 0
    })
    await settle()

    emit('update-downloaded', { version: '0.3.0' })
    await settle()

    expect(spy.quitAndInstall).not.toHaveBeenCalled()
    h.stop()
  })

  /** 바쁠 때 받아 둔 업데이트는, 조용해진 뒤 다시 확인할 때 제안된다. */
  it('바빠서 미룬 제안은 다음 확인에서 다시 올라온다', async () => {
    const running = { count: 2 }
    const { updater, emit, spy } = fakeUpdater()
    const promptRestart = vi.fn(async () => true)
    const h = setupAutoUpdate({
      updater,
      isPackaged: true,
      promptRestart,
      runningSessions: () => running.count
    })
    await settle()

    emit('update-downloaded', { version: '0.3.0' })
    await settle()
    expect(promptRestart).not.toHaveBeenCalled()

    running.count = 0
    await h.check()
    await settle()

    expect(promptRestart).toHaveBeenCalledWith('0.3.0')
    // 이미 받아 둔 상태라 서버에 다시 묻지 않는다(시작 시 1회뿐).
    expect(spy.checkForUpdates).toHaveBeenCalledTimes(1)
    h.stop()
  })

  /**
   * 🛑 업데이트 실패가 앱을 방해하면 안 된다. 네트워크가 없거나 서버가 잠깐 죽은 것뿐일 수
   * 있고, 그때 사용자는 그냥 도구를 쓰고 싶을 뿐이다.
   */
  it('확인이 실패해도 예외가 새어나가지 않는다', async () => {
    const { updater, emit } = fakeUpdater()
    updater.checkForUpdates = vi.fn(async () => {
      throw new Error('ENOTFOUND dl.getpes.com')
    })
    const logs: string[] = []
    const h = setupAutoUpdate({
      updater,
      isPackaged: true,
      promptRestart: async () => true,
      runningSessions: () => 0,
      log: (m) => logs.push(m)
    })
    await settle()

    // 서버가 error 이벤트로 알려오는 경로도 마찬가지다.
    expect(() => emit('error', new Error('boom'))).not.toThrow()
    await expect(h.check()).resolves.toBeUndefined()
    expect(logs.some((l) => l.includes('실패'))).toBe(true)
    h.stop()
  })

  it('stop 하면 주기 확인이 멈춘다', async () => {
    const { updater, spy } = fakeUpdater()
    const h = setupAutoUpdate({
      updater,
      isPackaged: true,
      promptRestart: async () => false,
      runningSessions: () => 0,
      intervalMs: 10
    })
    await settle()
    h.stop()

    const calls = spy.checkForUpdates.mock.calls.length
    await new Promise((r) => setTimeout(r, 40))
    expect(spy.checkForUpdates.mock.calls.length).toBe(calls)
  })
})
