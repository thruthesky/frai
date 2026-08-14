/**
 * 기본 AI — getpes.com 을 경유하는 DeepSeek 릴레이.
 *
 * 목적: 아무 설정 없이 **즉시, 무료로** 인공지능을 쓸 수 있게 한다.
 * BYOK 앱의 가장 큰 진입 장벽인 "API 키 발급" 을 첫 경험에서 제거한다.
 *
 *   FRAI ──POST──> https://getpes.com/frai/api/chat ──> api.deepseek.com
 *        <──SSE──                                   <──
 *
 * DeepSeek API 키는 **서버에만** 있고 앱에는 절대 내려오지 않는다.
 *
 * ⚠️ 개인정보: 이 경로는 대화 내용이 getpes.com 서버를 지난다. FRAI 의
 * "대화는 로컬을 벗어나지 않는다" 원칙의 유일한 예외이므로, UI 에서 반드시
 * 명시적으로 고지해야 한다(`kind: 'relay'`, `leavesDevice: true`).
 *
 * 이 파일은 `electron` 을 import 하지 않는다 — 기기 ID 경로·버전·토큰은 주입받는다.
 */

import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { ChatRequest, Usage } from '../../shared/types.js'
import { emptyUsage, type EventSink } from '../events.js'
import type { Provider } from './index.js'

export const PROVIDER_ID = 'frai-default'

const DEFAULT_ENDPOINT = 'https://getpes.com/frai/api/chat'

export interface RelayOptions {
  /** 릴레이 엔드포인트. 개발·테스트에서 모의 서버를 가리킬 때 쓴다. */
  endpoint?: string
  /** 기기 ID 파일 경로. main 이 `app.getPath('userData')` 로 채운다. */
  deviceIdPath: string
  appVersion: string
  /** 로그인 상태면 `Bearer ...`, 아니면 null. 토큰 자체는 renderer 로 나가지 않는다. */
  bearer: () => string | null
}

export class RelayProvider implements Provider {
  readonly #opts: RelayOptions

  constructor(opts: RelayOptions) {
    this.#opts = opts
  }

  async stream(req: ChatRequest, sink: EventSink, signal: AbortSignal): Promise<Usage> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Frai-Device': deviceId(this.#opts.deviceIdPath),
      'X-Frai-Version': this.#opts.appVersion
    }
    // 로그인했으면 계정 기준으로 쿼터를 센다(익명 5회 → 로그인 20회).
    const auth = this.#opts.bearer()
    if (auth) headers.Authorization = auth

    let resp: Response
    try {
      resp = await fetch(this.#opts.endpoint ?? DEFAULT_ENDPOINT, {
        method: 'POST',
        headers,
        body: JSON.stringify({ messages: req.messages }),
        signal
      })
    } catch (e) {
      if (signal.aborted) throw e
      throw new Error(`서버에 연결하지 못했습니다: ${String(e)}`)
    }

    // 일일 무료 한도 초과 — 사용자에게 다음 행동을 안내해야 하는 중요한 상태다.
    if (resp.status === 429) {
      throw new Error(
        '오늘의 무료 사용 횟수를 모두 썼습니다. 설정에서 개인 API 키를 등록하거나 ' +
          '설치된 CLI(claude 등)를 연결하면 계속 쓸 수 있습니다.'
      )
    }

    if (!resp.ok) {
      const body = (await resp.text().catch(() => '')).slice(0, 300)
      throw new Error(`서버 오류 (${resp.status}): ${body}`)
    }
    if (!resp.body) throw new Error('서버가 빈 응답을 보냈습니다.')

    sink.started(PROVIDER_ID)

    const usage = emptyUsage()
    const decoder = new TextDecoder()
    let buf = ''

    /**
     * 한 줄을 해석해 이벤트로 내보낸다.
     * 스트림을 여기서 끝내야 하면 최종 사용량을 돌려주고, 계속 읽어야 하면 null.
     */
    const handle = (line: string): Usage | null => {
      const ev = parseSseLine(line)
      switch (ev.type) {
        case 'chunk':
          sink.chunk(ev.text)
          return null
        case 'done':
          return ev.usage
        case 'error':
          // ⚠️ 여기서 sink.error() 를 부르지 않는다.
          // 오류 이벤트의 발신 책임자는 SessionManager 한 곳이다. 양쪽이 모두
          // 내보내면 error 가 두 번 가거나 error 뒤에 done 이 따라붙는다
          // (Tauri 판에 실제로 있던 결함이다).
          throw new Error(ev.message)
        case 'stop':
          return usage
        case 'ignore':
          return null
      }
    }

    for await (const chunk of resp.body as unknown as AsyncIterable<Uint8Array>) {
      buf += decoder.decode(chunk, { stream: true })

      // SSE 는 줄 단위다. 마지막 조각은 아직 완성되지 않았을 수 있으므로 남겨 둔다.
      let idx: number
      while ((idx = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, idx).replace(/\r+$/, '')
        buf = buf.slice(idx + 1)

        const finished = handle(line)
        if (finished !== null) return finished
      }
    }

    // ⚠️ 스트림이 개행 없이 끝나면 마지막 줄이 `buf` 에 남는다. 이것을 버리면
    // 대개 `done` 이벤트가 통째로 사라져 **사용량·비용이 표시되지 않는다.**
    // (`decode()` 를 인자 없이 한 번 더 불러 멀티바이트 잔여분까지 비운다.)
    buf += decoder.decode()
    const tail = buf.replace(/\r+$/, '')
    if (tail !== '') {
      const finished = handle(tail)
      if (finished !== null) return finished
    }

    return usage
  }
}

/** `parseSseLine` 의 결과. 부수효과와 파싱을 분리해 테스트 가능하게 둔다. */
export type SseEvent =
  | { type: 'chunk'; text: string }
  | { type: 'done'; usage: Usage }
  | { type: 'error'; message: string }
  /** `data: [DONE]` — 사용량 정보 없이 스트림만 끝난 경우. */
  | { type: 'stop' }
  | { type: 'ignore' }

/**
 * SSE 한 줄을 해석한다.
 *
 * 서버가 보내는 이벤트 형식 (FRAI 릴레이 API 규약):
 *   data: {"type":"chunk","text":"..."}
 *   data: {"type":"done","usage":{"inputTokens":..,"outputTokens":..,"costUsd":..,"remainingFree":19}}
 *   data: {"type":"error","message":"..."}
 *   data: [DONE]
 */
export function parseSseLine(line: string): SseEvent {
  if (!line.startsWith('data:')) {
    // 주석(`:`)·`event:`·빈 줄 등 SSE 의 다른 필드는 이 규약에서 쓰지 않는다.
    return { type: 'ignore' }
  }
  const payload = line.slice('data:'.length).trim()
  if (payload === '') return { type: 'ignore' }
  if (payload === '[DONE]') return { type: 'stop' }

  let v: unknown
  try {
    v = JSON.parse(payload)
  } catch {
    return { type: 'ignore' }
  }
  if (typeof v !== 'object' || v === null) return { type: 'ignore' }
  const o = v as Record<string, unknown>

  switch (o.type) {
    case 'chunk': {
      const text = typeof o.text === 'string' ? o.text : ''
      return text === '' ? { type: 'ignore' } : { type: 'chunk', text }
    }
    case 'done': {
      const u = (typeof o.usage === 'object' && o.usage !== null ? o.usage : {}) as Record<string, unknown>
      return {
        type: 'done',
        usage: {
          inputTokens: num(u.inputTokens),
          outputTokens: num(u.outputTokens),
          costUsd: num(u.costUsd),
          remainingFree: num(u.remainingFree)
        }
      }
    }
    case 'error':
      return {
        type: 'error',
        message: typeof o.message === 'string' ? o.message : '서버에서 알 수 없는 오류가 발생했습니다.'
      }
    default:
      return { type: 'ignore' }
  }
}

const num = (x: unknown): number | null => (typeof x === 'number' && Number.isFinite(x) ? x : null)

/**
 * 익명 기기 식별자. 무료 사용량을 세는 기준이 된다.
 *
 * ⚠️ 이것만으로는 남용을 막지 못한다. 파일을 지우거나 앱을 재설치하면 새 ID 가 발급된다.
 * 서버 쪽에 **전역 일일 예산 상한**과 추가 방어(계정 로그인 등)가 반드시 필요하다.
 */
let cachedDeviceId: string | null = null
export function deviceId(path: string): string {
  if (cachedDeviceId !== null) return cachedDeviceId
  try {
    const existing = readFileSync(path, 'utf8').trim()
    if (existing !== '') {
      cachedDeviceId = existing
      return cachedDeviceId
    }
  } catch {
    // 없으면 새로 만든다.
  }
  const fresh = randomUUID()
  try {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, fresh)
  } catch (e) {
    console.warn(`기기 ID 저장 실패(${path}): ${String(e)}`)
  }
  cachedDeviceId = fresh
  return fresh
}

/** 테스트에서 기기 ID 캐시를 비운다. */
export function resetDeviceIdCache(): void {
  cachedDeviceId = null
}
