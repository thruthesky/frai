/**
 * 프론트 상태 로직 테스트.
 *
 * ⚠️ node 환경에서 돌며 앱 창을 띄우지 않는다. Tauri 호출은 모킹하고,
 * Rust 가 보내는 이벤트는 캡처한 리스너를 직접 호출해 재현한다.
 * 즉 실제 앱과 같은 경로로 상태가 바뀌는지 검증한다.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProviderInfo, SessionEvent } from '../../shared/types'

const h = vi.hoisted(() => ({
  invoke: vi.fn(),
  /** main 이 보낼 세션 이벤트 리스너를 잡아 둔다. */
  sessionListener: null as null | ((e: { payload: SessionEvent }) => void),
}))

/**
 * preload 가 심어 주는 `window.frai` 를 흉내 낸다.
 *
 * 각 함수가 예전 IPC 이름·인자 모양 그대로 `h.invoke` 를 부르므로, 이전부터 있던
 * 검증(어떤 명령이 몇 번 어떤 인자로 갔는가)이 스택을 바꾼 뒤에도 그대로 안전망이 된다.
 * ⚠️ `sessions.svelte.ts` 가 모듈 최상단에서 `window.frai` 를 캡처하므로,
 *    이 stub 은 반드시 아래 동적 import **보다 먼저** 실행되어야 한다.
 */
vi.stubGlobal('window', {
  frai: {
    listProviders: () => h.invoke('list_providers'),
    sendMessage: (request: unknown) => h.invoke('send_message', { request }),
    cancelSession: (sessionId: string) => h.invoke('cancel_session', { sessionId }),
    authStatus: () => h.invoke('auth_status'),
    authSignIn: () => h.invoke('auth_sign_in'),
    authSignOut: () => h.invoke('auth_sign_out'),
    diagnostics: () => h.invoke('diagnostics'),
    onSessionEvent: (handler: (ev: SessionEvent) => void) => {
      h.sessionListener = (e) => handler(e.payload)
      return () => {}
    },
    onSetView: () => () => {},
  },
})

const { BACKLOG_ID, Session, SessionStore } = await import('./sessions.svelte')

const PROVIDERS: ProviderInfo[] = [
  {
    id: 'frai-default',
    label: '기본 AI (무료)',
    kind: 'relay',
    available: true,
    reason: null,
    path: null,
    leavesDevice: true,
  },
  {
    id: 'claude',
    label: 'Claude Code',
    kind: 'cli',
    available: true,
    reason: null,
    path: '/Users/x/.local/bin/claude',
    leavesDevice: false,
  },
]

/** Rust 가 이벤트를 보낸 것처럼 흉내낸다. */
function emit(ev: SessionEvent) {
  if (!h.sessionListener) throw new Error('session-event 리스너가 등록되지 않았다')
  h.sessionListener({ payload: ev })
}

async function freshStore() {
  h.invoke.mockReset()
  h.sessionListener = null
  h.invoke.mockImplementation(async (cmd: string) => {
    if (cmd === 'list_providers') return PROVIDERS
    if (cmd === 'auth_status') return { signedIn: false, uid: null, displayName: null }
    return undefined
  })
  const store = new SessionStore()
  await store.init()
  return store
}

describe('세션 초기화', () => {
  it('바둑판 기본값인 2×2 로 시작한다', async () => {
    const store = await freshStore()
    expect(store.sessions).toHaveLength(4)
    expect(store.columns).toBe(2)
    expect(store.ready).toBe(true)
  })

  it('모든 세션이 Backlog 에서 시작한다', async () => {
    const store = await freshStore()
    expect(store.sessions.every((s) => s.columnId === BACKLOG_ID)).toBe(true)
    expect(store.sessionsIn(BACKLOG_ID)).toHaveLength(4)
  })

  it('사용 가능한 첫 프로바이더를 기본값으로 쓴다', async () => {
    const store = await freshStore()
    expect(store.defaultProviderId).toBe('frai-default')
    expect(store.sessions[0].providerId).toBe('frai-default')
  })
})

describe('세션 제목', () => {
  it('질문이 없으면 임시 이름을 보여준다', () => {
    const s = new Session('claude')
    expect(s.displayTitle).toContain('새 세션')
  })

  it('첫 질문에서 제목을 만든다', () => {
    const s = new Session('claude')
    s.messages.push({ role: 'user', content: '스트리밍 성능을 어떻게 개선하지?', done: true })
    expect(s.displayTitle).toBe('스트리밍 성능을 어떻게 개선하지?')
  })

  it('긴 질문은 잘라서 보여준다', () => {
    const s = new Session('claude')
    s.messages.push({ role: 'user', content: '가'.repeat(100), done: true })
    expect(s.displayTitle).toHaveLength(41) // 40자 + 말줄임표
    expect(s.displayTitle.endsWith('…')).toBe(true)
  })

  it('사용자가 붙인 이름이 자동 생성보다 우선한다', () => {
    const s = new Session('claude')
    s.messages.push({ role: 'user', content: '자동 생성될 제목', done: true })
    s.title = '내가 정한 이름'
    expect(s.displayTitle).toBe('내가 정한 이름')
  })
})

describe('스트리밍 이벤트 처리', () => {
  it('청크가 이어붙고 done 에서 완결된다', async () => {
    const store = await freshStore()
    const s = store.sessions[0]

    emit({ kind: 'started', sessionId: s.id, provider: 'claude' })
    expect(s.streaming).toBe(true)

    emit({ kind: 'chunk', sessionId: s.id, text: '안녕' })
    emit({ kind: 'chunk', sessionId: s.id, text: '하세요' })
    expect(s.messages.at(-1)?.content).toBe('안녕하세요')
    expect(s.messages.at(-1)?.done).toBe(false)

    emit({
      kind: 'done',
      sessionId: s.id,
      usage: { inputTokens: 3, outputTokens: 7, costUsd: 0, remainingFree: null },
    })
    expect(s.messages.at(-1)?.done).toBe(true)
    expect(s.streaming).toBe(false)
    expect(s.usage?.outputTokens).toBe(7)
  })

  /**
   * 비용 비교가 이 앱의 차별점인데, 전송할 때 usage 를 지우면 비교를 시작하는
   * 순간 직전 결과가 모든 칸에서 사라진다. 새 응답의 done 이 덮어쓸 때까지는
   * 남아 있어야 한다.
   */
  it('새 질문을 보내도 직전 응답의 비용이 남는다', async () => {
    const store = await freshStore()
    const s = store.sessions[0]

    emit({
      kind: 'done',
      sessionId: s.id,
      usage: { inputTokens: 3, outputTokens: 7, costUsd: 0.0012, remainingFree: 19 },
    })
    expect(s.usage?.costUsd).toBe(0.0012)

    await store.send(s, '다음 질문')
    expect(s.usage?.costUsd).toBe(0.0012)

    // 새 응답이 오면 그때 갱신된다.
    emit({
      kind: 'done',
      sessionId: s.id,
      usage: { inputTokens: 5, outputTokens: 9, costUsd: 0.0034, remainingFree: 18 },
    })
    expect(s.usage?.costUsd).toBe(0.0034)
  })

  /** 그리드의 핵심 전제 — 한 세션의 이벤트가 다른 칸을 오염시키면 안 된다. */
  it('이벤트는 세션 ID 로만 라우팅된다', async () => {
    const store = await freshStore()
    const [a, b] = store.sessions

    emit({ kind: 'chunk', sessionId: a.id, text: 'A 의 답' })
    expect(a.messages).toHaveLength(1)
    expect(b.messages).toHaveLength(0)
  })

  it('모르는 세션 ID 는 조용히 무시된다', async () => {
    const store = await freshStore()
    expect(() => emit({ kind: 'chunk', sessionId: '없는세션', text: 'x' })).not.toThrow()
    expect(store.sessions.every((s) => s.messages.length === 0)).toBe(true)
  })

  /** 한 세션의 실패가 다른 세션에 영향을 주면 안 된다. */
  it('오류는 해당 세션만 중단시킨다', async () => {
    const store = await freshStore()
    const [a, b] = store.sessions

    emit({ kind: 'started', sessionId: a.id, provider: 'claude' })
    emit({ kind: 'started', sessionId: b.id, provider: 'claude' })
    emit({ kind: 'error', sessionId: a.id, message: '실행 실패' })

    expect(a.streaming).toBe(false)
    expect(a.error).toBe('실행 실패')
    expect(b.streaming).toBe(true)
    expect(b.error).toBeNull()
  })

  it('started 는 이전 오류를 지운다', async () => {
    const store = await freshStore()
    const s = store.sessions[0]
    emit({ kind: 'error', sessionId: s.id, message: '이전 오류' })
    emit({ kind: 'started', sessionId: s.id, provider: 'claude' })
    expect(s.error).toBeNull()
  })
})

describe('메시지 전송', () => {
  it('전송하면 Rust 로 세션 ID 와 프로바이더가 함께 간다', async () => {
    const store = await freshStore()
    const s = store.sessions[0]
    s.providerId = 'claude'
    await store.send(s, '  안녕  ')

    const call = h.invoke.mock.calls.find(([cmd]) => cmd === 'send_message')
    expect(call).toBeDefined()
    expect(call![1].request.sessionId).toBe(s.id)
    expect(call![1].request.provider).toBe('claude')
    expect(call![1].request.messages.at(-1).content).toBe('안녕') // 앞뒤 공백 제거
  })

  it('빈 입력은 보내지 않는다', async () => {
    const store = await freshStore()
    await store.send(store.sessions[0], '   ')
    expect(h.invoke.mock.calls.some(([cmd]) => cmd === 'send_message')).toBe(false)
  })

  it('스트리밍 중인 세션에는 다시 보내지 않는다', async () => {
    const store = await freshStore()
    const s = store.sessions[0]
    s.streaming = true
    await store.send(s, '안녕')
    expect(h.invoke.mock.calls.some(([cmd]) => cmd === 'send_message')).toBe(false)
  })

  /**
   * ⚠️ 회귀 방지 — started 이벤트가 오기 **전**에도 재전송이 막혀야 한다.
   *
   * started 는 릴레이 HTTP 가 성공한 뒤에야 나간다(relay.rs). 예전에는 streaming 을
   * started 에서만 켰기 때문에, 그 사이 네트워크 대기 구간에 같은 칸으로 다시 보낼 수
   * 있었다. 그러면 start() 가 이전 태스크를 취소하고 새 요청을 열어 서버 무료 횟수가
   * 이중으로 차감된다. 위 테스트는 streaming 을 손으로 켜서 이 구간을 못 잡는다.
   */
  it('started 이벤트가 오기 전에도 재전송을 막는다', async () => {
    const store = await freshStore()
    const s = store.sessions[0]

    await store.send(s, '첫 번째')
    // 여기서 session-event(started) 를 일부러 보내지 않는다 — 응답 대기 중인 상태.
    await store.send(s, '두 번째')

    const sent = h.invoke.mock.calls.filter(([cmd]) => cmd === 'send_message')
    expect(sent).toHaveLength(1)
    expect(sent[0][1].request.messages.at(-1).content).toBe('첫 번째')
  })

  /** 이 앱의 핵심 사용 흐름 — 같은 질문을 여러 AI 에 동시에 던진다. */
  it('브로드캐스트는 선택된 세션에만 보낸다', async () => {
    const store = await freshStore()
    store.sessions[1].selected = false
    store.sessions[3].selected = false

    await store.broadcast('같은 질문')

    const sent = h.invoke.mock.calls
      .filter(([cmd]) => cmd === 'send_message')
      .map(([, arg]) => arg.request.sessionId)
    expect(sent).toEqual([store.sessions[0].id, store.sessions[2].id])
  })

  it('전송 실패는 그 세션의 오류로 표시된다', async () => {
    const store = await freshStore()
    h.invoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'send_message') throw '실행 파일을 찾지 못했습니다'
      return undefined
    })
    const s = store.sessions[0]
    await store.send(s, '안녕')
    expect(s.error).toContain('찾지 못했습니다')
    expect(s.streaming).toBe(false)
  })
})

describe('칸반 보드', () => {
  it('세션을 다른 칸으로 옮긴다', async () => {
    const store = await freshStore()
    const s = store.sessions[0]
    store.move(s, 'doing')
    expect(s.columnId).toBe('doing')
    expect(store.sessionsIn('doing')).toHaveLength(1)
    expect(store.sessionsIn(BACKLOG_ID)).toHaveLength(3)
  })

  it('없는 칸으로는 옮기지 않는다', async () => {
    const store = await freshStore()
    const s = store.sessions[0]
    store.move(s, '없는칸')
    expect(s.columnId).toBe(BACKLOG_ID)
  })

  it('칸을 추가하고 이름을 바꾼다', async () => {
    const store = await freshStore()
    const before = store.board.length
    store.addColumn('검토 중')
    expect(store.board).toHaveLength(before + 1)

    const added = store.board.at(-1)!
    store.renameColumn(added.id, '리뷰')
    expect(store.board.at(-1)!.title).toBe('리뷰')
  })

  /** 칸을 지웠다고 세션이 사라지면 안 된다. */
  it('칸을 지우면 그 안의 세션은 Backlog 로 돌아온다', async () => {
    const store = await freshStore()
    store.addColumn('임시')
    const temp = store.board.at(-1)!
    store.move(store.sessions[0], temp.id)
    store.move(store.sessions[1], temp.id)
    expect(store.sessionsIn(temp.id)).toHaveLength(2)

    store.removeColumn(temp.id)

    expect(store.board.some((c) => c.id === temp.id)).toBe(false)
    expect(store.sessions).toHaveLength(4) // 세션은 하나도 잃지 않는다
    expect(store.sessionsIn(BACKLOG_ID)).toHaveLength(4)
  })

  /** Backlog 가 사라지면 새 세션이 갈 곳이 없어진다. */
  it('Backlog 는 삭제되지 않는다', async () => {
    const store = await freshStore()
    store.removeColumn(BACKLOG_ID)
    expect(store.board.some((c) => c.id === BACKLOG_ID)).toBe(true)
  })
})

describe('세션 추가와 제거', () => {
  it('추가한 세션은 Backlog 로 들어간다', async () => {
    const store = await freshStore()
    store.add()
    expect(store.sessions).toHaveLength(5)
    expect(store.sessions.at(-1)!.columnId).toBe(BACKLOG_ID)
  })

  it('마지막 한 개는 지워지지 않는다', async () => {
    const store = await freshStore()
    while (store.sessions.length > 1) store.remove(store.sessions[0])
    store.remove(store.sessions[0])
    expect(store.sessions).toHaveLength(1)
  })
})

describe('계정', () => {
  it('처음에는 익명이며 앱은 그대로 동작한다', async () => {
    const store = await freshStore()
    expect(store.auth.signedIn).toBe(false)
    expect(store.ready).toBe(true)
    expect(store.sessions).toHaveLength(4)
  })

  it('로그인 실패는 오류로 표시되고 익명 상태를 유지한다', async () => {
    const store = await freshStore()
    h.invoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'auth_sign_in') throw '로그인 시간이 초과되었습니다.'
      return undefined
    })
    await store.signIn()
    expect(store.auth.signedIn).toBe(false)
    expect(store.authError).toContain('초과')
    expect(store.authBusy).toBe(false)
  })
})
