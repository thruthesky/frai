/**
 * PKCE 순수 로직 검증.
 *
 * 이 값들이 어긋나면 로그인이 서버에서 조용히 거절된다(서버는 실패 사유를 알려주지
 * 않는 설계라 더 찾기 어렵다). 네트워크도 창도 필요 없는 순수 함수라 그대로 검증한다.
 */

import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { buildAuthUrl, challengeOf, generateState, generateVerifier, parseCallback } from './pkce.js'

describe('PKCE', () => {
  it('verifier 는 RFC 7636 길이 범위(43~128)를 지킨다', () => {
    const v = generateVerifier()
    expect(v.length).toBeGreaterThanOrEqual(43)
    expect(v.length).toBeLessThanOrEqual(128)
  })

  it('verifier 는 URL-safe 문자만 쓴다', () => {
    expect(generateVerifier()).toMatch(/^[A-Za-z0-9\-_]+$/)
  })

  it('매번 다른 값이 나온다', () => {
    expect(generateVerifier()).not.toBe(generateVerifier())
    expect(generateState()).not.toBe(generateState())
  })

  it('challenge 는 BASE64URL(SHA256(verifier)) 이다', () => {
    const v = 'test-verifier-값'
    const expected = createHash('sha256').update(v).digest('base64url')
    expect(challengeOf(v)).toBe(expected)
    // 패딩(=)이 없어야 한다 — 있으면 서버 대조가 실패한다.
    expect(challengeOf(v)).not.toContain('=')
  })

  it('로그인 URL 에 필수 파라미터가 전부 담긴다', () => {
    const url = new URL(
      buildAuthUrl({
        authBase: 'https://getpes.com',
        redirectUri: 'http://127.0.0.1:51234/callback',
        state: 'st',
        challenge: 'ch'
      })
    )
    expect(url.pathname).toBe('/frai/auth')
    expect(url.searchParams.get('redirect_uri')).toBe('http://127.0.0.1:51234/callback')
    expect(url.searchParams.get('state')).toBe('st')
    expect(url.searchParams.get('code_challenge')).toBe('ch')
    // S256 이 아니면 PKCE 의 의미가 없다(plain 은 가로채기를 막지 못한다).
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
  })

  it('콜백에서 code·state 를 뽑는다', () => {
    expect(parseCallback('GET /callback?code=abc&state=xyz HTTP/1.1')).toEqual({
      code: 'abc',
      state: 'xyz',
      error: null
    })
  })

  it('콜백의 오류도 읽는다', () => {
    expect(parseCallback('GET /callback?error=access_denied HTTP/1.1').error).toBe('access_denied')
  })
})
