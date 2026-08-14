/**
 * 자동 업데이트 정책.
 *
 * ⚠️ 이 파일은 `electron` 도 `electron-updater` 도 import 하지 않는다. 실제 구현은
 * `main/index.ts` 가 주입한다 — 그래야 **창을 띄우지 않고** 정책을 테스트할 수 있고,
 * `check:security` 의 "main 로직은 electron 을 모른다" 규칙도 지킨다.
 *
 * 정책의 핵심은 하나다: **사용자가 하던 일을 빼앗지 않는다.**
 * FRAI 는 여러 AI 세션을 동시에 돌리는 도구다. 한 세션이 몇 분씩 걸리기도 하는데
 * 그 와중에 "업데이트를 위해 재시작합니다" 를 띄우면 진행 중인 작업이 통째로 날아간다.
 * 그래서 다운로드는 조용히 하고, **세션이 하나도 안 돌 때만** 재시작을 제안한다.
 * 제안을 거절해도 손해가 없다 — 다음에 앱을 끄면 자동으로 적용된다.
 */

/** `electron-updater` 의 `autoUpdater` 중 이 모듈이 쓰는 부분만. */
export interface UpdaterLike {
  autoDownload: boolean
  autoInstallOnAppQuit: boolean
  checkForUpdates(): Promise<unknown>
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void
  on(event: string, listener: (...args: never[]) => void): unknown
}

export interface UpdaterDeps {
  updater: UpdaterLike
  /**
   * 패키징된 앱인가.
   * ⚠️ 개발 모드에서 `checkForUpdates()` 를 부르면 `app-update.yml` 이 없어 즉시 실패한다.
   *    기능이 망가진 것이 아니라 그 환경에 매니페스트가 없는 것이므로 아예 부르지 않는다.
   */
  isPackaged: boolean
  /** 새 버전을 받아 두었을 때 물어본다. true 면 지금 재시작. */
  promptRestart: (version: string) => Promise<boolean>
  /** 지금 돌고 있는 세션 수. 0 일 때만 재시작을 제안한다. */
  runningSessions: () => number
  /** 주기적 확인 간격(ms). 기본 6시간. */
  intervalMs?: number
  /** 진단 로그. 기본은 console. */
  log?: (message: string) => void
}

export const DEFAULT_INTERVAL_MS = 6 * 60 * 60 * 1000

/** `setupAutoUpdate` 가 돌려주는 제어권. 앱 종료 시 `stop()` 을 부른다. */
export interface UpdaterHandle {
  /** 즉시 한 번 확인한다(메뉴에서 수동으로 부를 수도 있다). */
  check(): Promise<void>
  stop(): void
}

export function setupAutoUpdate(deps: UpdaterDeps): UpdaterHandle {
  const log = deps.log ?? ((m: string) => console.info(`[updater] ${m}`))

  if (!deps.isPackaged) {
    log('개발 모드 — 업데이트를 확인하지 않는다')
    return { check: async () => {}, stop: () => {} }
  }

  const { updater } = deps

  // 받아 두는 것은 조용히, 적용은 앱을 끌 때. 사용자를 멈춰 세우지 않는 조합이다.
  updater.autoDownload = true
  updater.autoInstallOnAppQuit = true

  let downloaded: string | null = null
  let prompting = false

  updater.on('update-available', ((info: { version?: string }) => {
    log(`새 버전 ${info?.version ?? '?'} — 백그라운드로 내려받는다`)
  }) as (...args: never[]) => void)

  updater.on('update-not-available', (() => log('최신 버전이다')) as (...args: never[]) => void)

  updater.on('update-downloaded', ((info: { version?: string }) => {
    downloaded = info?.version ?? '새 버전'
    log(`내려받기 완료: ${downloaded}`)
    void offerRestart()
  }) as (...args: never[]) => void)

  // 🛑 업데이트 실패가 앱을 방해하면 안 된다. 네트워크가 없거나 서버가 잠깐 죽은 것뿐일
  //    수 있고, 그때 사용자는 그냥 도구를 쓰고 싶을 뿐이다. 로그만 남긴다.
  updater.on('error', ((e: Error) => log(`확인 실패(무시): ${e?.message ?? String(e)}`)) as (
    ...args: never[]
  ) => void)

  /**
   * 재시작을 제안한다 — **세션이 하나도 안 돌 때만.**
   * 돌고 있으면 아무 말도 하지 않는다. 다음에 앱을 끄면 알아서 적용되므로 손해가 없다.
   */
  async function offerRestart(): Promise<void> {
    if (downloaded === null || prompting) return
    const running = deps.runningSessions()
    if (running > 0) {
      log(`세션 ${running}개가 진행 중 — 재시작을 권하지 않는다(앱을 끄면 자동 적용)`)
      return
    }
    prompting = true
    try {
      if (await deps.promptRestart(downloaded)) {
        log('사용자가 지금 재시작을 선택했다')
        updater.quitAndInstall()
      }
    } finally {
      prompting = false
    }
  }

  async function check(): Promise<void> {
    // 이미 받아 뒀다면 다시 확인할 이유가 없다. 대신 지금 조용해졌는지 다시 살펴본다.
    if (downloaded !== null) {
      await offerRestart()
      return
    }
    try {
      await updater.checkForUpdates()
    } catch (e) {
      log(`확인 실패(무시): ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  const timer = setInterval(() => void check(), deps.intervalMs ?? DEFAULT_INTERVAL_MS)
  // 업데이트 확인 때문에 앱이 종료되지 못하는 일은 없어야 한다.
  timer.unref?.()

  void check()

  return {
    check,
    stop: () => clearInterval(timer)
  }
}
