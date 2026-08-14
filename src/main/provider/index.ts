/**
 * 프로바이더 추상화.
 *
 * 서로 다른 전송 방식을 하나의 인터페이스로 감싼다.
 *   1. 릴레이     — getpes.com 을 거치는 기본 AI (DeepSeek)
 *   2. 서브프로세스 — 설치된 CLI (claude, codex, opencode, grok, kimi)
 *   3. HTTP/SSE   — 사용자 API 키 직접 호출 (예정)
 *
 * 전송 방식이 무엇이든 **renderer 가 받는 이벤트 스트림의 형태는 동일하다.**
 * 이 추상화가 무너지면 그리드 UI 가 프로바이더마다 분기 처리로 오염된다.
 */

import type { ChatRequest, Message, ProviderInfo, Usage } from '../../shared/types.js'
import type { EventSink } from '../events.js'
import { CLI_SPECS, cliSpec, findExecutable } from './detect.js'
import { CliProvider } from './cli.js'
import { PROVIDER_ID as RELAY_ID, RelayProvider, type RelayOptions } from './relay.js'

export interface Provider {
  /**
   * 응답을 스트리밍한다. 청크는 `sink` 로 내보내고, 최종 사용량을 반환한다.
   *
   * 취소는 `signal` 로 이뤄진다. 구현체는 **abort 시점에 자식 프로세스나 연결이
   * 확실히 정리되도록** 해야 한다.
   *
   * ⚠️ 오류는 `throw` 로만 알린다. `sink.error()` 를 직접 부르지 않는다 —
   * 오류 이벤트의 발신 책임자는 `SessionManager` 한 곳이다.
   */
  stream(req: ChatRequest, sink: EventSink, signal: AbortSignal): Promise<Usage>
}

/** `resolve` 가 릴레이를 만들 때 필요한 것들. main 이 주입한다. */
export type ResolveDeps = RelayOptions

/** 요청의 프로바이더 id 로 구현체를 고른다. */
export function resolve(id: string, deps: ResolveDeps): Provider {
  if (id === RELAY_ID) return new RelayProvider(deps)
  const spec = cliSpec(id)
  if (spec) return new CliProvider(spec)
  throw new Error(`알 수 없는 프로바이더입니다: ${id}`)
}

/**
 * 마지막 사용자 메시지를 프롬프트로 뽑는다.
 * CLI 는 대화 히스토리를 자체 세션으로 관리하므로 마지막 발화만 넘긴다.
 */
export function lastUserPrompt(messages: readonly Message[]): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') return messages[i].content
  }
  return null
}

/** 지금 쓸 수 있는 프로바이더 목록. 앱 시작 시와 설정 변경 시 호출한다. */
export async function listProviders(): Promise<ProviderInfo[]> {
  const out: ProviderInfo[] = [
    // 기본 AI — 설정 없이 즉시 쓸 수 있는 경로. 항상 첫 번째에 둔다.
    {
      id: RELAY_ID,
      label: '기본 AI (무료)',
      kind: 'relay',
      available: true,
      reason: null,
      path: null,
      leavesDevice: true
    }
  ]

  for (const spec of CLI_SPECS) {
    const found = await findExecutable(spec.bin)
    const available = found !== null
    let reason: string | null = null
    if (!available) reason = `\`${spec.bin}\` 를 찾지 못했습니다.`
    else if (!spec.verified) reason = '실험적 지원 — 출력 형식이 검증되지 않았습니다.'

    out.push({
      id: spec.id,
      label: spec.label,
      kind: 'cli',
      available,
      reason,
      path: found,
      leavesDevice: false
    })
  }

  return out
}

export { RELAY_ID }
