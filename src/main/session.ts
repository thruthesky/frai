/**
 * 세션 관리 — 그리드로 동시에 돌아가는 여러 대화를 서로 독립적으로 다룬다.
 *
 * 규칙:
 * - 한 세션의 실패가 다른 세션에 영향을 주지 않는다.
 * - 세션을 취소하면 자식 프로세스·연결이 확실히 정리된다(AbortSignal → 프로세스 그룹 종료).
 * - 앱이 종료될 때 남은 세션을 전부 정리한다. 그리드로 여러 개를 돌리므로
 *   누수가 빠르게 쌓인다.
 * - **오류 이벤트를 내보내는 곳은 여기 한 곳뿐이다.** 어댑터는 throw 만 하고
 *   `sink.error()` 를 부르지 않는다. 양쪽이 다 부르면 error 가 두 번 가거나
 *   error 뒤에 done 이 따라붙는다(Tauri 판에 실제로 있던 결함이다).
 *
 * 이 파일은 `electron` 을 import 하지 않는다.
 */

import type { ChatRequest } from '../shared/types.js'
import { EventSink, type EmitFn } from './events.js'
import { resolve, type ResolveDeps } from './provider/index.js'

export class SessionManager {
  readonly #running = new Map<string, AbortController>()
  readonly #deps: ResolveDeps

  constructor(deps: ResolveDeps) {
    this.#deps = deps
  }

  /**
   * 세션을 시작한다. 같은 세션이 이미 돌고 있으면 먼저 취소한다.
   *
   * 프로바이더 해석 실패는 **동기적으로 throw** 한다 — 잘못된 id 면 태스크를
   * 띄우기 전에 실패시켜 renderer 의 invoke 가 곧바로 reject 되게 한다.
   */
  start(req: ChatRequest, emit: EmitFn): void {
    const provider = resolve(req.provider, this.#deps)

    this.cancel(req.sessionId)

    const ac = new AbortController()
    this.#running.set(req.sessionId, ac)
    const sink = new EventSink(req.sessionId, emit)

    void (async () => {
      try {
        const usage = await provider.stream(req, sink, ac.signal)
        if (!ac.signal.aborted) sink.done(usage)
      } catch (e) {
        // 사용자가 취소한 것은 오류가 아니다 — 조용히 끝낸다.
        if (!ac.signal.aborted) sink.error(e instanceof Error ? e.message : String(e))
      } finally {
        // 그 사이 같은 세션이 다시 시작됐으면 새 컨트롤러를 지우면 안 된다.
        if (this.#running.get(req.sessionId) === ac) this.#running.delete(req.sessionId)
      }
    })()
  }

  /** 세션을 취소한다. 돌고 있지 않으면 아무 일도 하지 않는다. */
  cancel(sessionId: string): void {
    const ac = this.#running.get(sessionId)
    if (!ac) return
    this.#running.delete(sessionId)
    ac.abort()
    console.info(`세션 취소: ${sessionId}`)
  }

  cancelAll(): void {
    for (const [id, ac] of this.#running) {
      ac.abort()
      console.info(`앱 종료로 세션 취소: ${id}`)
    }
    this.#running.clear()
  }

  /** 진행 중인 세션 수 — 테스트와 진단용. */
  get runningCount(): number {
    return this.#running.size
  }
}
