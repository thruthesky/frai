/**
 * PES(getpes.com) 호환 로그인 — 시스템 브라우저 + 루프백 콜백 + PKCE.
 *
 * 왜 커스텀 스킴(`frai://`)이 아니라 루프백인가:
 *   - 커스텀 스킴은 앱이 OS 에 등록돼야 동작한다. 즉 개발 모드에서는 재현되지 않고
 *     배포본에서만 확인된다(PATH 함정과 같은 구조).
 *   - 브라우저가 사용자 제스처 없는 스킴 전환을 차단하는 경우가 있다.
 *   - 다른 앱이 같은 스킴을 등록하는 것을 막을 수 없다(하이재킹).
 *   루프백(127.0.0.1)은 RFC 8252 가 네이티브 앱에 권장하는 방식이며 위 문제가 없다.
 *
 * 흐름:
 *   1. verifier/challenge(PKCE) + state 생성, 127.0.0.1 임의 포트에 1회용 서버 기동
 *   2. 시스템 브라우저로 getpes.com 로그인 페이지 열기
 *   3. 로그인 성공 → 브라우저가 http://127.0.0.1:PORT/callback?code=..&state=.. 로 이동
 *   4. 앱이 code 를 받아 서버에 교환 요청(verifier 동봉) → 세션 토큰 획득
 *   5. 토큰은 **OS 가 보호하는 저장소에** 둔다. renderer 에는 절대 내려보내지 않는다.
 *
 * ⚠️ 이 파일은 `electron` 을 import 하지 않는다. 브라우저 열기와 저장소는
 *    주입받으므로 로그인 흐름 전체를 창 없이 테스트할 수 있다.
 */

import { createServer } from 'node:http'
import type { AuthStatus } from '../../shared/types.js'
import { buildAuthUrl, challengeOf, generateState, generateVerifier } from './pkce.js'

export interface StoredSession {
  token: string
  uid: string
  displayName: string | null
}

/** 토큰 저장소. 실제 구현은 electron `safeStorage` 를 쓴다(store.ts). */
export interface SessionStore {
  load(): StoredSession | null
  save(s: StoredSession): void
  clear(): void
}

export interface AuthDeps {
  store: SessionStore
  /** 시스템 브라우저로 URL 을 연다. */
  openExternal(url: string): Promise<void>
  /** 기본 https://getpes.com. 개발 중에는 로컬 PES 를 가리킬 수 있다. */
  authBase?: string
  /** 로그인 대기 제한(ms). 기본 5분. */
  timeoutMs?: number
}

const DEFAULT_BASE = 'https://getpes.com'

export class Auth {
  readonly #deps: AuthDeps

  constructor(deps: AuthDeps) {
    this.#deps = deps
  }

  get #base(): string {
    return this.#deps.authBase ?? process.env.FRAI_AUTH_BASE ?? DEFAULT_BASE
  }

  status(): AuthStatus {
    const s = this.#deps.store.load()
    return s
      ? { signedIn: true, uid: s.uid, displayName: s.displayName }
      : { signedIn: false, uid: null, displayName: null }
  }

  /** API 호출에 붙일 인증 헤더 값. 토큰 자체는 이 모듈 밖으로 나가지 않는다. */
  bearer(): string | null {
    const s = this.#deps.store.load()
    return s ? `Bearer ${s.token}` : null
  }

  /** 시스템 브라우저를 열고 로그인이 끝날 때까지 기다린다. */
  async signIn(): Promise<AuthStatus> {
    const verifier = generateVerifier()
    const challenge = challengeOf(verifier)
    const state = generateState()

    const { port, waitForCode, close } = await startLoopbackServer(state, this.#deps.timeoutMs ?? 300_000)
    const redirectUri = `http://127.0.0.1:${port}/callback`

    try {
      await this.#deps.openExternal(buildAuthUrl({ authBase: this.#base, redirectUri, state, challenge }))
      const code = await waitForCode()

      const res = await fetch(new URL('/frai/api/auth/exchange', this.#base), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, codeVerifier: verifier, redirectUri })
      })
      if (!res.ok) {
        // 서버는 실패 사유(없음/이미 씀/PKCE 불일치)를 구분해 주지 않는다 — 의도된 설계다.
        throw new Error(`로그인 교환에 실패했습니다 (${res.status})`)
      }
      const body = (await res.json()) as { token?: string; uid?: string; displayName?: string | null }
      if (!body.token || !body.uid) throw new Error('서버 응답에 토큰이 없습니다.')

      this.#deps.store.save({ token: body.token, uid: body.uid, displayName: body.displayName ?? null })
      return this.status()
    } finally {
      close()
    }
  }

  /**
   * 로그아웃.
   *
   * ⚠️ Tauri 판은 키체인만 지우고 **서버 토큰을 살려 뒀다.** 기기에서 지워도 토큰이
   * 유효하면 유출 시 그대로 쓰인다. 서버에 `revoke` 엔드포인트가 이미 있으므로
   * 반드시 함께 폐기한다. 서버 호출이 실패해도 로컬 삭제는 진행한다 — 사용자가
   * 로그아웃을 눌렀는데 기기에 토큰이 남는 것이 더 나쁘다.
   */
  async signOut(): Promise<AuthStatus> {
    const s = this.#deps.store.load()
    if (s) {
      try {
        await fetch(new URL('/frai/api/auth/revoke', this.#base), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${s.token}` },
          body: JSON.stringify({ token: s.token })
        })
      } catch (e) {
        console.warn(`서버 토큰 폐기 실패(로컬 삭제는 계속한다): ${String(e)}`)
      }
    }
    this.#deps.store.clear()
    return this.status()
  }
}

/**
 * 1회용 루프백 서버. code 를 받으면 브라우저에 안내 문구를 보여주고 닫는다.
 *
 * `state` 가 일치하지 않는 요청은 받아들이지 않는다 — 다른 페이지가 우리 포트로
 * 요청을 보내 code 를 주입하는 것을 막는다.
 */
async function startLoopbackServer(
  expectedState: string,
  timeoutMs: number
): Promise<{ port: number; waitForCode: () => Promise<string>; close: () => void }> {
  let resolveCode: (code: string) => void
  let rejectCode: (e: Error) => void
  const codePromise = new Promise<string>((res, rej) => {
    resolveCode = res
    rejectCode = rej
  })

  const server = createServer((req, res) => {
    const u = new URL(req.url ?? '/', 'http://127.0.0.1')
    if (u.pathname !== '/callback') {
      res.writeHead(404).end()
      return
    }
    const code = u.searchParams.get('code')
    const state = u.searchParams.get('state')
    const error = u.searchParams.get('error')

    const reply = (msg: string) => {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(`<!doctype html><meta charset="utf-8"><body style="font-family:system-ui;padding:2rem">
        <h2>${msg}</h2><p>이 창을 닫고 FRAI 로 돌아가세요.</p></body>`)
    }

    if (error) {
      reply('로그인이 취소되었습니다.')
      rejectCode(new Error(`로그인이 취소되었습니다: ${error}`))
    } else if (state !== expectedState) {
      reply('요청이 올바르지 않습니다.')
      rejectCode(new Error('state 가 일치하지 않습니다. 로그인을 다시 시도해 주세요.'))
    } else if (!code) {
      reply('요청이 올바르지 않습니다.')
      rejectCode(new Error('서버가 code 를 보내지 않았습니다.'))
    } else {
      reply('로그인되었습니다.')
      resolveCode(code)
    }
  })

  await new Promise<void>((res) => server.listen(0, '127.0.0.1', res))
  const addr = server.address()
  if (addr === null || typeof addr === 'string') throw new Error('루프백 서버 주소를 얻지 못했습니다.')

  const timer = setTimeout(() => rejectCode(new Error('로그인 대기 시간이 지났습니다.')), timeoutMs)

  return {
    port: addr.port,
    waitForCode: () => codePromise,
    close: () => {
      clearTimeout(timer)
      server.close()
    }
  }
}
