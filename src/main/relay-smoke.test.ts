/**
 * 릴레이 스모크 — **실제 getpes.com 릴레이(또는 로컬 개발 서버)를 진짜로 호출한다.**
 *
 * 평소에는 스킵된다. 비용과 외부 의존이 생기므로 기본 테스트에 넣지 않는다.
 * 돌리는 법:
 *
 *   # 로컬 PES 개발 서버를 띄운 상태에서
 *   FRAI_SMOKE_URL=http://localhost:5199/frai/api/chat npm run test
 *
 *   # 배포된 서버를 겨냥할 때
 *   FRAI_SMOKE_URL=https://getpes.com/frai/api/chat npm run test
 *
 * ⚠️ 이것이 `session.test.ts` 의 모의 서버와 다른 점: 저쪽은 우리가 만든 문자열을
 * 우리가 파싱하는 것이라 **서버가 규약을 어겨도 초록이다.** 여기는 실제 서버가 만든
 * 바이트열을 앱 코드가 그대로 먹는다. 창은 여전히 뜨지 않는다.
 */

import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { SessionEvent } from '../shared/types.js'
import { SessionManager } from './session.js'

const url = process.env.FRAI_SMOKE_URL

describe.skipIf(!url)('릴레이 스모크 (실서버)', () => {
  it('프롬프트를 보내면 실제 응답이 흐르고 사용량이 온다', async () => {
    const events: SessionEvent[] = []
    const mgr = new SessionManager({
      endpoint: url,
      deviceIdPath: join(tmpdir(), `frai-smoke-device-${process.pid}`),
      appVersion: '0.0.0-smoke',
      bearer: () => null
    })

    mgr.start(
      {
        sessionId: 'smoke',
        provider: 'frai-default',
        messages: [{ role: 'user', content: '"안녕"이라고만 답해줘.' }]
      },
      (e) => events.push(e)
    )

    // 실제 네트워크라 넉넉히 기다린다.
    for (let i = 0; i < 120 && !events.some((e) => e.kind === 'done' || e.kind === 'error'); i++) {
      await new Promise((r) => setTimeout(r, 500))
    }

    const err = events.find((e) => e.kind === 'error')
    expect(err, err && 'message' in err ? err.message : '').toBeUndefined()

    expect(events[0]?.kind).toBe('started')
    const text = events
      .filter((e) => e.kind === 'chunk')
      .map((e) => (e as { text: string }).text)
      .join('')
    expect(text.length).toBeGreaterThan(0)

    const done = events.at(-1)
    expect(done?.kind).toBe('done')
    const usage = (done as { usage: { outputTokens: number | null; remainingFree: number | null } }).usage
    // 서버가 사용량을 실어 보내지 않으면 화면에 비용·남은 횟수가 안 뜬다.
    expect(usage.outputTokens).toBeGreaterThan(0)
    expect(usage.remainingFree).not.toBeNull()

    console.info(`스모크 응답: ${JSON.stringify(text.slice(0, 80))} · usage=${JSON.stringify(usage)}`)
  }, 70_000)
})
