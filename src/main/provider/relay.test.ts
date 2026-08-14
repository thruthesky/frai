/**
 * 릴레이 SSE 파서 — Tauri(Rust) 판의 `relay.rs` 테스트를 그대로 옮긴 것.
 *
 * 이식하면서 규약 해석이 달라지면 서버가 보낸 답이 화면에 안 뜨거나, 오류가
 * 조용히 삼켜진다. 같은 입력에 같은 판정이 나오는지가 이식의 정확성을 증명한다.
 * 창을 띄우지 않는다 — 순수 함수라 electron 도 네트워크도 필요 없다.
 */

import { describe, expect, it } from 'vitest'
import { parseSseLine } from './relay.js'

describe('릴레이 SSE 파서', () => {
  it('chunk 에서 본문을 뽑는다', () => {
    expect(parseSseLine('data: {"type":"chunk","text":"안녕"}')).toEqual({ type: 'chunk', text: '안녕' })
  })

  /** `data:` 뒤 공백이 없는 형태도 SSE 규격상 유효하다. */
  it('data 뒤 공백이 없어도 해석한다', () => {
    expect(parseSseLine('data:{"type":"chunk","text":"x"}')).toEqual({ type: 'chunk', text: 'x' })
  })

  it('done 에서 사용량과 남은 무료횟수를 뽑는다', () => {
    const line =
      'data: {"type":"done","usage":{"inputTokens":10,"outputTokens":20,"costUsd":0.0005,"remainingFree":19}}'
    expect(parseSseLine(line)).toEqual({
      type: 'done',
      usage: { inputTokens: 10, outputTokens: 20, costUsd: 0.0005, remainingFree: 19 }
    })
  })

  /** usage 가 통째로 빠져도 죽지 않아야 한다(서버 구현이 아직 유동적이다). */
  it('usage 가 없는 done 도 처리한다', () => {
    expect(parseSseLine('data: {"type":"done"}')).toEqual({
      type: 'done',
      usage: { inputTokens: null, outputTokens: null, costUsd: null, remainingFree: null }
    })
  })

  it('error 는 메시지를 전달한다', () => {
    expect(parseSseLine('data: {"type":"error","message":"한도 초과"}')).toEqual({
      type: 'error',
      message: '한도 초과'
    })
  })

  it('DONE 마커는 스트림을 끝낸다', () => {
    expect(parseSseLine('data: [DONE]')).toEqual({ type: 'stop' })
  })

  it('data 가 아닌 줄과 빈 청크는 무시된다', () => {
    expect(parseSseLine(': keep-alive')).toEqual({ type: 'ignore' })
    expect(parseSseLine('event: ping')).toEqual({ type: 'ignore' })
    expect(parseSseLine('')).toEqual({ type: 'ignore' })
    expect(parseSseLine('data:')).toEqual({ type: 'ignore' })
    expect(parseSseLine('data: {"type":"chunk","text":""}')).toEqual({ type: 'ignore' })
    expect(parseSseLine('data: not-json')).toEqual({ type: 'ignore' })
  })

  /**
   * 모르는 타입은 조용히 무시한다 — 서버가 나중에 새 이벤트를 추가해도
   * 구버전 앱이 깨지지 않아야 하기 때문이다(하위호환).
   */
  it('알 수 없는 type 은 무시한다', () => {
    expect(parseSseLine('data: {"type":"toolCall","name":"x"}')).toEqual({ type: 'ignore' })
  })
})
