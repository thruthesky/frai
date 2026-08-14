/**
 * renderer 로 내보내는 통일 이벤트.
 *
 * FRAI 의 핵심 규칙: 어떤 전송 방식(HTTP/SSE · 서브프로세스 · 릴레이)을 쓰든
 * renderer 가 받는 이벤트의 형태는 **완전히 동일하다.** renderer 는 응답이
 * 어디서 왔는지 알 필요가 없다. 이 규칙이 깨지면 그리드 UI 가 프로바이더마다
 * 분기 처리로 오염된다.
 *
 * ⚠️ 이 파일은 `electron` 을 import 하지 않는다.
 *    어댑터를 창 없이 테스트할 수 있는 이유가 바로 이것이다 — 어댑터 입장에서는
 *    "이벤트를 어디로 보내는지" 를 알 필요가 없고, 테스트는 수집 함수를 꽂는다.
 *    (Tauri 시절 `EventSink` 를 `AppHandle` 이 아니라 클로저로 둔 것과 같은 설계다.)
 */

import type { SessionEvent, Usage } from '../shared/types.js'

export type EmitFn = (ev: SessionEvent) => void

export class EventSink {
  readonly sessionId: string
  readonly #emit: EmitFn

  constructor(sessionId: string, emit: EmitFn) {
    this.sessionId = sessionId
    this.#emit = emit
  }

  /** 이벤트를 배열로 모으는 sink. 테스트에서 renderer 대신 받는다. */
  static collecting(sessionId: string): { sink: EventSink; events: SessionEvent[] } {
    const events: SessionEvent[] = []
    return { sink: new EventSink(sessionId, (ev) => events.push(ev)), events }
  }

  started(provider: string): void {
    this.#emit({ kind: 'started', sessionId: this.sessionId, provider })
  }

  chunk(text: string): void {
    this.#emit({ kind: 'chunk', sessionId: this.sessionId, text })
  }

  done(usage: Usage): void {
    this.#emit({ kind: 'done', sessionId: this.sessionId, usage })
  }

  error(message: string): void {
    this.#emit({ kind: 'error', sessionId: this.sessionId, message })
  }
}

export const emptyUsage = (): Usage => ({
  inputTokens: null,
  outputTokens: null,
  costUsd: null,
  remainingFree: null
})
