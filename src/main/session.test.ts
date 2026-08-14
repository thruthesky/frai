/**
 * 세션 관리 + 릴레이 어댑터 통합 검증.
 *
 * ⚠️ 이 층이 이번 이식에서 가장 중요하다. Tauri 판에서는 어댑터만 따로 테스트하고
 * `SessionManager` 를 통과하는 경로는 검증하지 않았는데, 바로 그 층에서 앱이 죽는
 * 버그(런타임 컨텍스트 밖 spawn)가 났고 `cargo test` 는 전부 초록이었다.
 * 그래서 여기서는 **모의 SSE 서버를 실제로 띄우고** 세션 → 프로바이더 → 이벤트까지
 * 끝까지 돌린다. 그러면서도 앱 창은 띄우지 않는다.
 */

import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { ChatRequest, SessionEvent } from '../shared/types.js'
import { resetDeviceIdCache } from './provider/relay.js'
import { SessionManager } from './session.js'

let server: Server | null = null

afterEach(() => {
  server?.close()
  server = null
  resetDeviceIdCache()
})

/** 지정한 본문을 그대로 흘려보내는 모의 SSE 서버. */
async function startSse(body: string, status = 200): Promise<string> {
  server = createServer((_req, res) => {
    res.writeHead(status, { 'Content-Type': status === 200 ? 'text/event-stream' : 'text/plain' })
    res.end(body)
  })
  await new Promise<void>((r) => server!.listen(0, '127.0.0.1', r))
  const addr = server!.address()
  if (addr === null || typeof addr === 'string') throw new Error('주소를 얻지 못했다')
  return `http://127.0.0.1:${addr.port}/`
}

function managerFor(endpoint: string): { mgr: SessionManager; events: SessionEvent[] } {
  const events: SessionEvent[] = []
  const mgr = new SessionManager({
    endpoint,
    deviceIdPath: join(tmpdir(), `frai-test-device-${process.pid}`),
    appVersion: '0.0.0-test',
    bearer: () => null
  })
  return { mgr, events }
}

const req = (overrides: Partial<ChatRequest> = {}): ChatRequest => ({
  sessionId: 's1',
  provider: 'frai-default',
  messages: [{ role: 'user', content: '안녕' }],
  ...overrides
})

/** 이벤트가 더 이상 오지 않을 때까지 기다린다. */
const settle = () => new Promise((r) => setTimeout(r, 120))

describe('SessionManager', () => {
  it('알 수 없는 프로바이더는 시작 전에 실패한다', () => {
    const { mgr, events } = managerFor('http://127.0.0.1:1/')
    expect(() => mgr.start(req({ provider: '없는-프로바이더' }), (e) => events.push(e))).toThrow(
      /알 수 없는 프로바이더/
    )
    // 태스크를 띄우기 전에 막혔으므로 이벤트가 하나도 없어야 한다.
    expect(events).toHaveLength(0)
  })

  it('릴레이 스트림을 끝까지 받아 started → chunk → done 순서로 낸다', async () => {
    const url = await startSse(
      'data: {"type":"chunk","text":"안"}\n' +
        'data: {"type":"chunk","text":"녕"}\n' +
        'data: {"type":"done","usage":{"inputTokens":3,"outputTokens":2,"costUsd":0.001,"remainingFree":4}}\n'
    )
    const { mgr, events } = managerFor(url)
    mgr.start(req(), (e) => events.push(e))
    await settle()

    expect(events.map((e) => e.kind)).toEqual(['started', 'chunk', 'chunk', 'done'])
    const text = events.filter((e) => e.kind === 'chunk').map((e) => (e as { text: string }).text).join('')
    expect(text).toBe('안녕')
    const done = events.at(-1) as { usage: { remainingFree: number | null } }
    expect(done.usage.remainingFree).toBe(4)
  })

  /**
   * ⚠️ Tauri 판에는 오류 뒤에 done 이 따라붙는 결함이 있었다(어댑터와 세션이 둘 다
   * 이벤트를 냈다). 오류 이벤트의 발신 책임자는 SessionManager 한 곳뿐이어야 한다.
   */
  it('서버 오류는 error 를 한 번만 내고 done 을 뒤에 붙이지 않는다', async () => {
    const url = await startSse('data: {"type":"error","message":"한도 초과"}\n')
    const { mgr, events } = managerFor(url)
    mgr.start(req(), (e) => events.push(e))
    await settle()

    const kinds = events.map((e) => e.kind)
    expect(kinds.filter((k) => k === 'error')).toHaveLength(1)
    expect(kinds).not.toContain('done')
    expect((events.at(-1) as { message: string }).message).toBe('한도 초과')
  })

  it('비-2xx 응답은 상태코드를 담은 오류로 바뀐다', async () => {
    const url = await startSse('not found', 404)
    const { mgr, events } = managerFor(url)
    mgr.start(req(), (e) => events.push(e))
    await settle()

    expect(events).toHaveLength(1)
    expect(events[0].kind).toBe('error')
    expect((events[0] as { message: string }).message).toMatch(/서버 오류 \(404\)/)
  })

  it('429 는 다른 경로를 안내한다', async () => {
    const url = await startSse('too many', 429)
    const { mgr, events } = managerFor(url)
    mgr.start(req(), (e) => events.push(e))
    await settle()

    expect((events[0] as { message: string }).message).toMatch(/무료 사용 횟수/)
  })

  it('취소하면 이후 이벤트가 나가지 않는다', async () => {
    const url = await startSse('data: {"type":"chunk","text":"x"}\n')
    const { mgr, events } = managerFor(url)
    mgr.start(req(), (e) => events.push(e))
    mgr.cancel('s1')
    await settle()

    // 취소는 오류가 아니다 — error 도 done 도 나가지 않아야 한다.
    expect(events.map((e) => e.kind)).not.toContain('error')
    expect(events.map((e) => e.kind)).not.toContain('done')
    expect(mgr.runningCount).toBe(0)
  })

  it('끝난 세션은 목록에서 스스로 빠진다', async () => {
    const url = await startSse('data: {"type":"done"}\n')
    const { mgr, events } = managerFor(url)
    mgr.start(req(), (e) => events.push(e))
    expect(mgr.runningCount).toBe(1)
    await settle()
    expect(mgr.runningCount).toBe(0)
  })

  it('모든 세션을 한 번에 취소한다', async () => {
    const url = await startSse('data: {"type":"chunk","text":"x"}\n')
    const { mgr, events } = managerFor(url)
    mgr.start(req({ sessionId: 'a' }), (e) => events.push(e))
    mgr.start(req({ sessionId: 'b' }), (e) => events.push(e))
    expect(mgr.runningCount).toBe(2)
    mgr.cancelAll()
    expect(mgr.runningCount).toBe(0)
  })
})
