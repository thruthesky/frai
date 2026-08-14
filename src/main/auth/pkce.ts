/**
 * PKCE(RFC 7636) 순수 로직.
 *
 * ⚠️ 루프백이라도 PKCE 는 반드시 쓴다. 같은 기기의 다른 프로세스가 code 를
 * 가로챌 가능성이 남아 있고, verifier 없이는 그 code 를 쓸 수 없어야 한다.
 *
 * 이 파일은 부수효과가 없다 — 네트워크·파일·electron 을 건드리지 않으므로
 * 창 없이 그대로 테스트된다.
 */

import { createHash, randomBytes } from 'node:crypto'

const base64url = (b: Buffer): string => b.toString('base64url')

/** code_verifier — 43~128자의 URL-safe 문자열이어야 한다(RFC 7636 §4.1). */
export function generateVerifier(): string {
  return base64url(randomBytes(64))
}

/** code_challenge = BASE64URL(SHA256(verifier)) — method 는 항상 S256 이다. */
export function challengeOf(verifier: string): string {
  return base64url(createHash('sha256').update(verifier).digest())
}

/** CSRF 방지용 state. 서버는 받은 값을 그대로 돌려주고, 앱이 대조한다. */
export function generateState(): string {
  return base64url(randomBytes(24))
}

/** 로그인 시작 URL 을 만든다. */
export function buildAuthUrl(opts: {
  authBase: string
  redirectUri: string
  state: string
  challenge: string
}): string {
  const u = new URL('/frai/auth', opts.authBase)
  u.searchParams.set('redirect_uri', opts.redirectUri)
  u.searchParams.set('state', opts.state)
  u.searchParams.set('code_challenge', opts.challenge)
  u.searchParams.set('code_challenge_method', 'S256')
  return u.toString()
}

/**
 * 루프백 콜백 요청줄에서 code·state 를 뽑는다.
 *
 * 서버가 무엇을 보내든 앱은 **자기가 만든 state 와 일치할 때만** 받아들여야 한다.
 * (대조는 호출자가 한다 — 여기서는 파싱만 하고 판단하지 않는다.)
 */
export function parseCallback(requestLine: string): { code: string | null; state: string | null; error: string | null } {
  // "GET /callback?code=..&state=.. HTTP/1.1"
  const m = /^[A-Z]+\s+(\S+)/.exec(requestLine)
  if (!m) return { code: null, state: null, error: null }
  const u = new URL(m[1], 'http://127.0.0.1')
  return {
    code: u.searchParams.get('code'),
    state: u.searchParams.get('state'),
    error: u.searchParams.get('error')
  }
}
