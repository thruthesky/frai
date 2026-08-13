import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import type { AuthStatus, ChatMessage, ProviderInfo, SessionEvent, Usage } from './types'

let seq = 0
let columnSeq = 0

export const BACKLOG_ID = 'backlog'

export interface Column {
  id: string
  title: string
  /** 기본 칸은 지울 수 없다. 세션이 갈 곳이 없어지면 안 되기 때문이다. */
  fixed?: boolean
}

/**
 * 그리드 칸 하나 = 세션 하나.
 * 세션끼리는 완전히 독립이다 — 한 세션의 실패가 다른 세션에 영향을 주지 않는다.
 */
export class Session {
  readonly id = `s${++seq}`
  providerId = $state('')
  messages = $state<ChatMessage[]>([])
  streaming = $state(false)
  error = $state<string | null>(null)
  usage = $state<Usage | null>(null)
  /** 브로드캐스트(전체 전송) 대상에 포함할지 */
  selected = $state(true)
  /** 사용자가 직접 붙인 이름. 비어 있으면 첫 질문에서 자동으로 만든다. */
  title = $state('')
  /** 칸반 보드에서 속한 칸 */
  columnId = $state(BACKLOG_ID)

  constructor(providerId: string) {
    this.providerId = providerId
  }

  /** 목록·보드에 보여줄 이름. */
  get displayTitle(): string {
    if (this.title.trim()) return this.title.trim()
    const first = this.messages.find((m) => m.role === 'user')?.content.trim()
    if (first) return first.length > 40 ? `${first.slice(0, 40)}…` : first
    return `새 세션 ${this.id}`
  }

  /** 스트리밍 중인 마지막 assistant 메시지. 없으면 null. */
  get pending(): ChatMessage | null {
    const last = this.messages[this.messages.length - 1]
    return last && last.role === 'assistant' && !last.done ? last : null
  }
}

export class SessionStore {
  providers = $state<ProviderInfo[]>([])
  sessions = $state<Session[]>([])
  /** 그리드 열 수 */
  columns = $state(2)
  ready = $state(false)

  /** 화면 전환: 바둑판 그리드 ↔ 칸반 보드 */
  view = $state<'grid' | 'board'>('grid')

  /** 계정 상태. 익명으로도 앱은 완전히 동작한다 — 로그인은 부가 기능이다. */
  auth = $state<AuthStatus>({ signedIn: false, uid: null, displayName: null })
  authBusy = $state(false)
  authError = $state<string | null>(null)

  /** 칸반 칸 목록. 첫 칸(Backlog)은 고정이며 새 세션이 여기로 들어간다. */
  board = $state<Column[]>([
    { id: BACKLOG_ID, title: 'Backlog', fixed: true },
    { id: 'todo', title: 'TODO' },
    { id: 'doing', title: 'In progress' },
    { id: 'done', title: 'Done' },
  ])

  get defaultProviderId(): string {
    return this.providers.find((p) => p.available)?.id ?? 'frai-default'
  }

  provider(id: string): ProviderInfo | undefined {
    return this.providers.find((p) => p.id === id)
  }

  sessionsIn(columnId: string): Session[] {
    return this.sessions.filter((s) => s.columnId === columnId)
  }

  async init() {
    this.providers = await invoke<ProviderInfo[]>('list_providers')
    this.auth = await invoke<AuthStatus>('auth_status')

    // 처음 화면은 2×2 로 시작한다. 바둑판이 이 앱의 기본 형태다.
    if (this.sessions.length === 0) {
      const id = this.defaultProviderId
      this.sessions = [new Session(id), new Session(id), new Session(id), new Session(id)]
    }

    await listen<SessionEvent>('session-event', (e) => this.#apply(e.payload))
    // 네이티브 메뉴(보기 → 세션 목록)에서 오는 화면 전환 요청.
    await listen<'grid' | 'board'>('set-view', (e) => {
      this.view = e.payload
    })
    this.ready = true
  }

  #apply(ev: SessionEvent) {
    const s = this.sessions.find((x) => x.id === ev.sessionId)
    if (!s) return

    switch (ev.kind) {
      case 'started':
        s.streaming = true
        s.error = null
        break

      case 'chunk': {
        // 스트리밍 중인 메시지에만 이어 붙인다. 완결된 메시지는 건드리지 않으므로
        // 다시 렌더되지 않는다 — 그리드로 여러 세션을 동시에 돌릴 때 중요하다.
        const last = s.messages[s.messages.length - 1]
        if (last && last.role === 'assistant' && !last.done) {
          last.content += ev.text
        } else {
          s.messages.push({ role: 'assistant', content: ev.text, done: false })
        }
        break
      }

      case 'done': {
        const last = s.messages[s.messages.length - 1]
        if (last && last.role === 'assistant') last.done = true
        s.streaming = false
        s.usage = ev.usage
        break
      }

      case 'error': {
        const last = s.messages[s.messages.length - 1]
        if (last && last.role === 'assistant') last.done = true
        s.streaming = false
        s.error = ev.message
        break
      }
    }
  }

  async send(session: Session, text: string) {
    const prompt = text.trim()
    if (!prompt || session.streaming) return

    session.error = null
    session.usage = null
    session.messages.push({ role: 'user', content: prompt, done: true })

    try {
      await invoke('send_message', {
        request: {
          sessionId: session.id,
          provider: session.providerId,
          messages: session.messages
            .filter((m) => m.done || m.role === 'user')
            .map((m) => ({ role: m.role, content: m.content })),
        },
      })
    } catch (e) {
      session.error = String(e)
      session.streaming = false
    }
  }

  /** 같은 질문을 선택된 모든 세션에 동시에 던진다. 이 앱의 핵심 사용 흐름이다. */
  async broadcast(text: string) {
    const targets = this.sessions.filter((s) => s.selected && !s.streaming)
    await Promise.all(targets.map((s) => this.send(s, text)))
  }

  async cancel(session: Session) {
    await invoke('cancel_session', { sessionId: session.id })
    session.streaming = false
  }

  add() {
    this.sessions.push(new Session(this.defaultProviderId))
  }

  remove(session: Session) {
    if (this.sessions.length <= 1) return
    void this.cancel(session)
    this.sessions = this.sessions.filter((s) => s !== session)
  }

  // ── 계정 ───────────────────────────────────────────────────

  /**
   * 시스템 브라우저에서 getpes.com 로그인을 진행한다.
   * 브라우저가 열리고 로그인이 끝날 때까지 이 호출은 대기한다(최대 5분).
   */
  async signIn() {
    if (this.authBusy) return
    this.authBusy = true
    this.authError = null
    try {
      this.auth = await invoke<AuthStatus>('auth_sign_in')
    } catch (e) {
      this.authError = String(e)
    } finally {
      this.authBusy = false
    }
  }

  async signOut() {
    this.authBusy = true
    this.authError = null
    try {
      this.auth = await invoke<AuthStatus>('auth_sign_out')
    } catch (e) {
      this.authError = String(e)
    } finally {
      this.authBusy = false
    }
  }

  // ── 칸반 보드 ──────────────────────────────────────────────

  move(session: Session, columnId: string) {
    if (!this.board.some((c) => c.id === columnId)) return
    session.columnId = columnId
  }

  addColumn(title = '새 칸') {
    this.board.push({ id: `c${++columnSeq}-${Date.now().toString(36)}`, title })
  }

  renameColumn(id: string, title: string) {
    const col = this.board.find((c) => c.id === id)
    if (col) col.title = title
  }

  /** 칸을 지우면 그 안의 세션은 Backlog 로 돌려보낸다. 세션은 절대 잃지 않는다. */
  removeColumn(id: string) {
    const col = this.board.find((c) => c.id === id)
    if (!col || col.fixed) return
    for (const s of this.sessions) {
      if (s.columnId === id) s.columnId = BACKLOG_ID
    }
    this.board = this.board.filter((c) => c.id !== id)
  }
}

export const store = new SessionStore()
