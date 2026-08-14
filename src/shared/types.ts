/**
 * main 프로세스와 renderer 가 **함께** 쓰는 타입.
 *
 * Tauri 시절에는 Rust `events.rs`·`provider/mod.rs` 와 손으로 맞춰야 했지만
 * (그래서 "한쪽만 고치지 말 것" 이라는 주석이 필요했다), 이제 양쪽이 같은
 * TypeScript 라 **컴파일러가 강제한다.** 여기만 고치면 양쪽이 함께 깨진다.
 */

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

/** 프로바이더에 넘기는 대화 한 줄. `ChatMessage` 와 달리 표시용 상태(done)가 없다. */
export interface Message {
  role: 'user' | 'assistant'
  content: string
}

/** renderer → main 으로 보내는 전송 요청. */
export interface ChatRequest {
  sessionId: string
  /** `listProviders` 가 돌려준 id 중 하나. */
  provider: string
  messages: Message[]
  /** CLI 세션 재개용. 없으면 새 대화로 시작한다. */
  resumeId?: string | null
}

/**
 * IPC 채널 이름 — preload 화이트리스트의 **유일한 출처**.
 *
 * ⚠️ 여기 없는 채널은 renderer 가 부를 수 없다. Tauri 의 capability 가 하던
 * 역할을 이 목록과 preload 가 대신한다. 채널을 추가하는 것은 신뢰 경계를
 * 넓히는 일이므로, 추가 전에 정말 renderer 가 그것을 해야 하는지 따져라.
 */
export const IPC = {
  listProviders: 'providers:list',
  sendMessage: 'session:send',
  cancelSession: 'session:cancel',
  authStatus: 'auth:status',
  authSignIn: 'auth:signIn',
  authSignOut: 'auth:signOut',
  diagnostics: 'diagnostics:get',
  /** main → renderer 단방향 이벤트. */
  sessionEvent: 'session:event',
  setView: 'view:set'
} as const

export type IpcChannel = (typeof IPC)[keyof typeof IPC]

/** preload 가 renderer 에 노출하는 API. `window.frai` 로 접근한다. */
export interface FraiApi {
  listProviders(): Promise<ProviderInfo[]>
  sendMessage(request: ChatRequest): Promise<void>
  cancelSession(sessionId: string): Promise<void>
  authStatus(): Promise<AuthStatus>
  authSignIn(): Promise<AuthStatus>
  authSignOut(): Promise<AuthStatus>
  diagnostics(): Promise<{ path: string; shell: string }>
  /** 구독을 끊는 함수를 돌려준다. */
  onSessionEvent(handler: (ev: SessionEvent) => void): () => void
  onSetView(handler: (view: 'grid' | 'board') => void): () => void
}
