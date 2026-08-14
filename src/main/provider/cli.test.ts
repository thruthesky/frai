/**
 * claude stream-json 파서 + CLI 스펙 불변식 —
 * Tauri(Rust) 판의 `claude_cli.rs` · `detect.rs` 테스트를 옮긴 것.
 *
 * 창을 띄우지 않는다. 프로세스도 띄우지 않는다(파싱과 목록 검사뿐).
 */

import { describe, expect, it } from 'vitest'
import { parseClaudeLine } from './cli.js'
import { CLI_SPECS, cliSpec, findExecutable, userPath } from './detect.js'

describe('claude stream-json 파서', () => {
  /** 실측한 첫 줄. 세션 정보일 뿐 본문이 아니므로 무시되어야 한다. */
  it('system init 은 무시된다', () => {
    const line = '{"type":"system","subtype":"init","session_id":"abc","tools":["Bash"]}'
    expect(parseClaudeLine(line)).toEqual({ kind: 'ignore' })
  })

  it('rate_limit_event 는 무시된다', () => {
    expect(parseClaudeLine('{"type":"rate_limit_event","status":"ok"}')).toEqual({ kind: 'ignore' })
  })

  it('assistant 메시지에서 본문을 뽑는다', () => {
    const line = '{"type":"assistant","message":{"content":[{"type":"text","text":"2"}]}}'
    expect(parseClaudeLine(line)).toEqual({ kind: 'text', text: '2' })
  })

  it('assistant 의 text 블록만 이어붙인다', () => {
    const line = `{"type":"assistant","message":{"content":[
      {"type":"text","text":"안녕"},
      {"type":"tool_use","id":"t1","name":"Bash","input":{}},
      {"type":"text","text":"하세요"}
    ]}}`
    expect(parseClaudeLine(line)).toEqual({ kind: 'text', text: '안녕하세요' })
  })

  it('툴 블록만 있으면 무시된다', () => {
    const line = '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Bash"}]}}'
    expect(parseClaudeLine(line)).toEqual({ kind: 'ignore' })
  })

  it('result 에서 비용과 토큰을 뽑는다', () => {
    const line = `{"type":"result","subtype":"success","is_error":false,"result":"2",
      "total_cost_usd":0.0123,"usage":{"input_tokens":2,"output_tokens":1}}`
    expect(parseClaudeLine(line)).toEqual({
      kind: 'finished',
      cost: 0.0123,
      input: 2,
      output: 1,
      error: null
    })
  })

  it('is_error 인 result 는 오류를 담아 온다', () => {
    const line = '{"type":"result","is_error":true,"result":"한도 초과"}'
    expect(parseClaudeLine(line)).toEqual({
      kind: 'finished',
      cost: null,
      input: null,
      output: null,
      error: '한도 초과'
    })
  })

  /** JSON 이 아닌 줄(경고 등)을 본문으로 오해시키면 안 된다. */
  it('JSON 이 아닌 줄과 빈 줄은 무시된다', () => {
    expect(parseClaudeLine('warning: something')).toEqual({ kind: 'ignore' })
    expect(parseClaudeLine('   ')).toEqual({ kind: 'ignore' })
  })
})

describe('CLI 스펙', () => {
  it('id 로 조회된다', () => {
    expect(cliSpec('claude')?.bin).toBe('claude')
    expect(cliSpec('존재하지-않는-cli')).toBeUndefined()
  })

  /** id 가 겹치면 resolve 가 엉뚱한 어댑터를 고르게 된다. */
  it('id 는 중복되지 않는다', () => {
    const ids = new Set(CLI_SPECS.map((s) => s.id))
    expect(ids.size).toBe(CLI_SPECS.length)
  })

  /**
   * 실제 출력 형식을 확인한 것은 claude 뿐이다. 나머지를 검증됨으로 올리려면
   * 반드시 `--help` 로 확인한 뒤 이 테스트도 함께 고쳐야 한다.
   */
  it('검증된 CLI 는 claude 뿐이다', () => {
    expect(CLI_SPECS.filter((s) => s.verified).map((s) => s.id)).toEqual(['claude'])
  })

  it('stream-json 형식은 해당 인자를 갖는다', () => {
    for (const spec of CLI_SPECS.filter((s) => s.format === 'claudeStreamJson')) {
      expect(spec.args).toContain('--output-format')
      expect(spec.args).toContain('stream-json')
    }
  })
})

describe('PATH 탐지', () => {
  /** 로그인 셸에서 PATH 를 얻지 못하면 CLI 연동 전체가 무너진다. */
  it('사용자 PATH 를 확보한다', async () => {
    const path = await userPath()
    expect(path).not.toBe('')
    expect(path).toContain('/')
  })

  /** 셸에 반드시 있는 명령으로 탐지 로직 자체를 검증한다(특정 AI CLI 설치 여부와 무관). */
  it('PATH 에서 실행 파일을 찾는다', async () => {
    expect(await findExecutable('sh')).not.toBeNull()
    expect(await findExecutable('존재할리없는명령어xyz')).toBeNull()
  })
})
