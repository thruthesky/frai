/** Rust 쪽 `events.rs` · `provider/mod.rs` 와 1:1 로 대응한다. 한쪽만 고치지 말 것. */

export type ProviderKind = 'relay' | 'cli' | 'apiKey'

export interface ProviderInfo {
  id: string
  label: string
  kind: ProviderKind
  available: boolean
  /** 사용 불가 사유 또는 주의사항. 있으면 그대로 사용자에게 보여준다. */
  reason: string | null
  /** CLI 실행 파일 경로 (진단용) */
  path: string | null
  /** 대화가 기기를 벗어나는가. 릴레이만 true — UI 에 반드시 고지한다. */
  leavesDevice: boolean
}

export interface Usage {
  inputTokens: number | null
  outputTokens: number | null
  costUsd: number | null
  /** 기본 AI 의 남은 무료 횟수 */
  remainingFree: number | null
}

/** Rust 가 `session-event` 이름으로 보내는 통일 이벤트. */
export type SessionEvent =
  | { kind: 'started'; sessionId: string; provider: string }
  | { kind: 'chunk'; sessionId: string; text: string }
  | { kind: 'done'; sessionId: string; usage: Usage }
  | { kind: 'error'; sessionId: string; message: string }

/**
 * 계정 상태. 세션 토큰은 절대 프론트로 오지 않는다 — 키체인에만 있고
 * Rust 안에서만 쓰인다. 여기서는 "로그인했는가"와 "누구인가"만 안다.
 */
export interface AuthStatus {
  signedIn: boolean
  uid: string | null
  displayName: string | null
}

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  /** 스트리밍이 끝났는가. false 인 동안에만 내용이 갱신된다. */
  done: boolean
}
