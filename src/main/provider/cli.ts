/**
 * 설치된 CLI 를 자식 프로세스로 실행하는 어댑터.
 *
 * 보안 원칙:
 * - **셸을 거치지 않는다.** `sh -c` 를 쓰면 프롬프트에 인젝션이 가능해진다.
 *   실행 파일을 직접 spawn 하고 인자는 배열로 넘긴다(`shell: false` 가 기본값이다).
 * - **프롬프트는 인자가 아니라 stdin 으로 넘긴다.** 인자 길이 제한을 피하고,
 *   프로세스 목록(`ps`)에 사용자 대화가 노출되지 않는다.
 * - **허용 목록(`CLI_SPECS`)에 있는 실행 파일만** 구동한다. renderer 가 보낸
 *   임의 문자열을 명령으로 실행하지 않는다.
 *
 * ⚠️ 프로세스 정리: Tauri 판은 `kill_on_drop(true)` 로 태스크가 취소되면 자식이
 * 확실히 죽었다. Node 에는 그 장치가 없고 `spawn({signal})` 은 자식에게만 SIGTERM 을
 * 보내므로 **자식이 띄운 손자가 살아남는다.** 그리드로 6~9개를 동시에 돌리면 좀비가
 * 빠르게 쌓이므로, 여기서는 프로세스 **그룹** 전체를 죽인다(§killProcessTree).
 *
 * 이 파일은 `electron` 을 import 하지 않는다.
 */

import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import type { ChatRequest, Usage } from '../../shared/types.js'
import { emptyUsage, type EventSink } from '../events.js'
import { findExecutable, isWindows, userPath, type CliSpec } from './detect.js'
import { lastUserPrompt, type Provider } from './index.js'

export class CliProvider implements Provider {
  readonly #spec: CliSpec

  constructor(spec: CliSpec) {
    this.#spec = spec
  }

  async stream(req: ChatRequest, sink: EventSink, signal: AbortSignal): Promise<Usage> {
    const spec = this.#spec

    const bin = await findExecutable(spec.bin)
    if (bin === null) {
      throw new Error(
        `\`${spec.bin}\` 실행 파일을 찾지 못했습니다. 설치되어 있다면 설정에서 경로를 직접 지정해 주세요.`
      )
    }

    const prompt = lastUserPrompt(req.messages)
    if (prompt === null) throw new Error('보낼 사용자 메시지가 없습니다.')

    const args = [...spec.args]
    // 대화 이어가기. CLI 가 자체 세션을 관리하므로 히스토리를 다시 보내지 않는다.
    if (req.resumeId && spec.format === 'claudeStreamJson') args.push('--resume', req.resumeId)

    // ⚠️ 자식이 다시 자식을 띄우는 경우까지 고려해 PATH 를 명시적으로 물려준다.
    const path = await userPath()

    // 🛑 여기까지 오는 데 시간이 걸린다(실행 파일 탐색 + 로그인 셸 조회는 최대 10초).
    //    그 사이에 사용자가 취소했다면 **자식을 띄우면 안 된다.** 예전에는 그대로
    //    spawn 해서, 취소했는데도 CLI 가 백그라운드에서 살아 돌아가는 누수가 났다.
    signal.throwIfAborted()

    const child = spawn(bin, args, {
      env: { ...process.env, PATH: path },
      stdio: ['pipe', 'pipe', 'pipe'],
      // POSIX: 자기 자신을 그룹 리더로 만들어 손자까지 한 번에 죽일 수 있게 한다.
      // Windows: detached 는 새 콘솔을 뜻하므로 쓰지 않고 taskkill /T 로 트리를 죽인다.
      detached: !isWindows
    })

    const onAbort = () => killProcessTree(child.pid)
    signal.addEventListener('abort', onAbort, { once: true })
    // spawn 과 리스너 등록 사이의 틈에서 취소됐다면 리스너가 못 받는다. 한 번 더 확인한다.
    if (signal.aborted) killProcessTree(child.pid)

    try {
      return await run(child, spec, prompt, sink, signal)
    } finally {
      signal.removeEventListener('abort', onAbort)
      // 정상 종료 경로에서도 남은 손자가 없도록 한 번 더 정리한다.
      if (child.exitCode === null && child.signalCode === null) killProcessTree(child.pid)
    }
  }
}

async function run(
  child: ReturnType<typeof spawn>,
  spec: CliSpec,
  prompt: string,
  sink: EventSink,
  signal: AbortSignal
): Promise<Usage> {
  const spawnError = new Promise<never>((_, reject) => {
    child.once('error', (e) => reject(new Error(`\`${spec.bin}\` 실행에 실패했습니다: ${e.message}`)))
  })

  sink.started(spec.id)

  // 🛑 stdin 에 error 핸들러를 **반드시** 먼저 단다.
  //
  // 자식이 프롬프트를 읽기 전에 죽으면(실행 파일이 잘못됐거나 즉시 종료하는 경우)
  // 쓰기가 EPIPE 로 실패한다. Node 에서 스트림의 처리되지 않은 `error` 는 예외로
  // 승격되어 **main 프로세스 전체를 종료시킨다** — 그리드로 6~9개를 돌리는 앱에서
  // CLI 하나가 즉사하면 앱이 통째로 사라진다는 뜻이다.
  //
  // EPIPE 는 여기서 삼킨다. 진짜 실패 원인(exit code·stderr)은 아래에서 잡히므로
  // 사용자에게는 그쪽이 훨씬 정확한 메시지가 된다.
  child.stdin?.on('error', (e: NodeJS.ErrnoException) => {
    if (e.code !== 'EPIPE') console.warn(`\`${spec.bin}\` stdin 오류: ${e.message}`)
  })

  // 프롬프트를 stdin 으로 넘기고 즉시 닫는다(닫지 않으면 CLI 가 입력을 기다린다).
  child.stdin?.end(prompt)

  // stderr 는 따로 모은다. 실패했을 때 사용자에게 이유를 보여주기 위함이다.
  let stderrBuf = ''
  child.stderr?.on('data', (d: Buffer) => {
    if (stderrBuf.length < 4096) stderrBuf += d.toString()
  })

  const usage: Usage = {
    ...emptyUsage(),
    // CLI 경로는 구독 요금제로 커버되므로 FRAI 관점에서 추가 비용이 없다.
    // (claude 는 result 에 total_cost_usd 를 주므로 아래에서 덮어쓴다.)
    costUsd: 0
  }
  let resultError: string | null = null

  const readOutput = (async () => {
    if (!child.stdout) throw new Error('자식 프로세스의 stdout 을 열 수 없습니다.')
    const rl = createInterface({ input: child.stdout, crlfDelay: Infinity })
    for await (const line of rl) {
      // 🛑 취소된 뒤에는 한 글자도 화면으로 내보내지 않는다.
      //    자식을 죽여도 이미 파이프에 쌓인 출력은 계속 읽히므로, 여기서 끊지 않으면
      //    "중지를 눌렀는데 답변이 계속 늘어나는" 현상이 생긴다.
      if (signal.aborted) break
      if (spec.format === 'claudeStreamJson') {
        const parsed = parseClaudeLine(line)
        if (parsed.kind === 'text') {
          sink.chunk(parsed.text)
        } else if (parsed.kind === 'finished') {
          if (parsed.cost !== null) usage.costUsd = parsed.cost
          usage.inputTokens = parsed.input
          usage.outputTokens = parsed.output
          if (parsed.error !== null) resultError = parsed.error
        }
      } else if (line !== '') {
        sink.chunk(`${line}\n`)
      }
    }
  })()

  const exited = new Promise<number | null>((resolve) => {
    child.once('close', (code) => resolve(code))
  })

  await Promise.race([Promise.all([readOutput, exited]), spawnError])
  const code = await exited

  if (signal.aborted) throw new Error('취소되었습니다.')

  if (code !== 0) {
    const detail = stderrBuf.trim()
    throw new Error(
      detail === ''
        ? `\`${spec.id}\` 가 비정상 종료했습니다 (exit=${String(code)})`
        : `\`${spec.id}\` 실행 오류: ${detail}`
    )
  }
  // CLI 가 성공 코드로 끝났어도 result 가 오류를 담고 있을 수 있다.
  if (resultError !== null) throw new Error(resultError)

  return usage
}

/**
 * 자식과 그 손자까지 확실히 죽인다 — Rust `kill_on_drop(true)` 의 대응물.
 *
 * POSIX 는 `detached: true` 로 만든 프로세스 그룹에 음수 pid 로 신호를 보내고,
 * Windows 는 `taskkill /T` 로 트리를 정리한다.
 */
export function killProcessTree(pid: number | undefined): void {
  if (pid === undefined) return
  try {
    if (isWindows) {
      spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' })
    } else {
      process.kill(-pid, 'SIGKILL')
    }
  } catch {
    // 이미 죽었으면 무시한다.
  }
}

/** `parseClaudeLine` 의 결과. 부수효과(이벤트 전송)와 파싱을 분리해 테스트 가능하게 둔다. */
export type ClaudeLine =
  | { kind: 'text'; text: string }
  | { kind: 'finished'; cost: number | null; input: number | null; output: number | null; error: string | null }
  | { kind: 'ignore' }

/**
 * `claude -p --output-format stream-json --verbose` 의 JSONL 한 줄을 해석한다.
 *
 * 실측한 줄 구조:
 *   {"type":"system","subtype":"init","session_id":"..."}
 *   {"type":"rate_limit_event", ...}
 *   {"type":"assistant","message":{"content":[{"type":"text","text":"..."}],"usage":{...}}}
 *   {"type":"result","subtype":"success","result":"...","total_cost_usd":0.0,"usage":{...}}
 *
 * ⚠️ 이 형식은 **델타(토큰) 단위가 아니라 메시지 단위**다. 즉 답변이 완성된 뒤
 * 한 덩어리로 온다. 토큰 단위 스트리밍이 필요해지면 부분 메시지 옵션을 조사해
 * 여기를 확장한다.
 */
export function parseClaudeLine(raw: string): ClaudeLine {
  const line = raw.trim()
  if (line === '') return { kind: 'ignore' }

  let v: unknown
  try {
    v = JSON.parse(line)
  } catch {
    // JSON 이 아닌 줄(경고 등)은 조용히 흘린다. 본문으로 오해시키지 않는다.
    return { kind: 'ignore' }
  }
  if (typeof v !== 'object' || v === null) return { kind: 'ignore' }
  const o = v as Record<string, any>

  if (o.type === 'assistant') {
    const parts = o.message?.content
    if (!Array.isArray(parts)) return { kind: 'ignore' }
    let text = ''
    for (const part of parts) {
      // ⚠️ tool_use 블록은 지금 버린다 — 화면에 그릴 자리가 없기 때문이다.
      //    에이전트 작업을 보여주려면 이벤트 타입을 늘려야 한다(로드맵).
      if (part?.type === 'text' && typeof part.text === 'string') text += part.text
    }
    return text === '' ? { kind: 'ignore' } : { kind: 'text', text }
  }

  if (o.type === 'result') {
    const isError = o.is_error === true
    return {
      kind: 'finished',
      cost: typeof o.total_cost_usd === 'number' ? o.total_cost_usd : null,
      input: typeof o.usage?.input_tokens === 'number' ? o.usage.input_tokens : null,
      output: typeof o.usage?.output_tokens === 'number' ? o.usage.output_tokens : null,
      error: isError ? (typeof o.result === 'string' ? o.result : '알 수 없는 오류') : null
    }
  }

  return { kind: 'ignore' }
}
