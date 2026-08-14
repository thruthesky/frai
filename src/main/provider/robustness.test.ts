/**
 * 어댑터의 견고성 회귀 테스트 — **앱을 통째로 죽이거나 영구히 고장 내는 결함**만 다룬다.
 *
 * 여기 있는 두 항목은 `.cowork/electron-port-relay-check/final-report.md` §7-A 에서
 * 확정된 실결함이다. 창을 띄우지 않지만 **실제로 프로세스와 셸을 띄워서** 검증한다
 * (모킹으로는 "main 이 죽는지"를 확인할 수 없기 때문이다).
 */

import { chmodSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { CliProvider } from './cli.js'
import { resetPathCache, userPath, type CliSpec } from './detect.js'
import { emptyUsage, EventSink } from '../events.js'
import type { ChatRequest } from '../../shared/types.js'

const sinkOf = () => new EventSink('s1', () => {})

const req = (content: string): ChatRequest => ({
  sessionId: 's1',
  provider: 'test',
  messages: [{ role: 'user', content }]
})

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** `node -e <code>` 를 돌리는 임시 CLI 스펙. 실제 프로세스를 띄우되 창은 없다. */
const nodeSpec = (id: string, code: string): CliSpec => ({
  id,
  bin: 'node',
  label: id,
  args: ['-e', code],
  format: 'plainText',
  verified: false
})

describe('CLI stdin — 자식이 먼저 죽어도 main 이 살아남는다', () => {
  /**
   * ⚠️ 이것이 왜 치명적인가: Node 에서 스트림의 처리되지 않은 `error` 는 예외로
   * 승격되어 **프로세스 전체를 종료시킨다.** 그리드로 6~9개를 돌리는 앱에서 CLI
   * 하나가 즉사하면 앱이 통째로 사라진다는 뜻이다.
   *
   * 프롬프트를 파이프 버퍼(보통 64KB)보다 크게 만들어 EPIPE 를 확실히 유발한다.
   */
  it('프롬프트를 읽지 않고 즉시 종료하는 CLI 는 EPIPE 가 아니라 종료 코드로 보고된다', async () => {
    const spec: CliSpec = {
      id: 'test-instant-exit',
      bin: 'node',
      label: '즉시 종료',
      // stdin 을 전혀 읽지 않고 바로 죽는다.
      args: ['-e', 'process.exit(3)'],
      format: 'plainText',
      verified: false
    }
    const huge = 'x'.repeat(1_000_000)

    await expect(
      new CliProvider(spec).stream(req(huge), sinkOf(), new AbortController().signal)
    ).rejects.toThrow(/exit=3/)
    // 여기까지 도달했다는 것 자체가 검증이다 — 예전 코드였다면 이 시점에
    // 테스트 러너(=main 역할)가 EPIPE 로 죽어 테스트가 아예 끝나지 않았다.
  })

  it('실행 파일이 없으면 명확한 안내로 실패한다', async () => {
    const spec: CliSpec = {
      id: 'test-missing',
      bin: 'frai-존재하지-않는-실행파일',
      label: '없음',
      args: [],
      format: 'plainText',
      verified: false
    }
    await expect(
      new CliProvider(spec).stream(req('안녕'), sinkOf(), new AbortController().signal)
    ).rejects.toThrow(/찾지 못했습니다/)
  })
})

describe('CLI 취소 — 취소는 즉시, 완전히 적용된다', () => {
  let dir: string | null = null

  afterEach(() => {
    if (dir !== null) rmSync(dir, { recursive: true, force: true })
    dir = null
  })

  /**
   * ⚠️ 실행 파일 탐색과 로그인 셸 PATH 조회는 **최대 10초**가 걸린다. 그 사이 취소하면
   * 예전에는 그대로 spawn 해서, 사용자가 중지를 눌렀는데도 CLI 가 백그라운드에서
   * 살아 돌아갔다. 자식이 실제로 안 떴는지를 **마커 파일 부재**로 확인한다.
   */
  it('시작 전에 취소되면 자식을 아예 띄우지 않는다', async () => {
    dir = mkdtempSync(join(tmpdir(), 'frai-spawn-'))
    const marker = join(dir, 'spawned')
    const spec = nodeSpec(
      'test-cancel-before-spawn',
      `require('fs').writeFileSync(${JSON.stringify(marker)}, 'x')`
    )

    const ac = new AbortController()
    ac.abort()

    await expect(new CliProvider(spec).stream(req('x'), sinkOf(), ac.signal)).rejects.toThrow()
    await sleep(200) // 혹시 늦게 떴다면 이 사이에 마커가 생긴다
    expect(existsSync(marker)).toBe(false)
  })

  /**
   * ⚠️ 자식을 죽여도 **이미 파이프에 쌓인 출력은 계속 읽힌다.** 루프에서 끊지 않으면
   * "중지를 눌렀는데 답변이 계속 늘어나는" 현상이 생긴다.
   */
  it('스트리밍 중 취소하면 그 뒤 출력이 화면으로 새지 않는다', async () => {
    // 5ms 마다 한 줄씩, 넉넉히 오래 출력한다.
    const spec = nodeSpec(
      'test-cancel-mid-stream',
      'let i = 0; const t = setInterval(() => { console.log("line" + ++i); if (i > 400) { clearInterval(t) } }, 5)'
    )

    const ac = new AbortController()
    const { sink, events } = EventSink.collecting('s1')
    const chunks = () => events.filter((e) => e.kind === 'chunk').length

    const running = new CliProvider(spec).stream(req('go'), sink, ac.signal).catch(() => {})

    // 실제로 스트리밍이 시작된 뒤에 취소해야 이 테스트가 의미를 갖는다.
    for (let i = 0; i < 100 && chunks() === 0; i++) await sleep(20)
    expect(chunks()).toBeGreaterThan(0)

    const atAbort = chunks()
    ac.abort()
    await running
    await sleep(200)

    // 취소 시점에 이미 읽던 한 줄까지는 허용한다. 그 이상 늘어나면 새고 있는 것이다.
    expect(chunks()).toBeLessThanOrEqual(atAbort + 1)
  })
})

describe('PATH 조회 — 실패는 캐시하지 않는다', () => {
  const origShell = process.env.SHELL
  let dir: string | null = null

  afterEach(() => {
    if (origShell === undefined) delete process.env.SHELL
    else process.env.SHELL = origShell
    if (dir !== null) rmSync(dir, { recursive: true, force: true })
    dir = null
    resetPathCache()
  })

  /**
   * ⚠️ 예전에는 실패한 fallback 도 캐시해서, 로그인 셸이 한 번이라도 삐끗하면
   * 프로세스가 사는 내내 잘못된 PATH 를 쓰고 CLI 를 **영영** 찾지 못했다.
   */
  it('셸 실행이 실패한 뒤 다시 부르면 회복한다', async () => {
    if (process.platform === 'win32') return // Windows 는 상속 PATH 가 정답이라 이 경로를 타지 않는다

    resetPathCache()
    process.env.SHELL = '/frai/존재하지-않는/셸'
    const failed = await userPath()
    expect(failed).toBe(process.env.PATH ?? '') // fallback 으로 물러선다

    // 셸이 정상으로 돌아온 상황을 흉내낸다. 실패가 캐시됐다면 아래 값이 나올 수 없다.
    dir = mkdtempSync(join(tmpdir(), 'frai-shell-'))
    const fake = join(dir, 'fake-shell')
    writeFileSync(fake, '#!/bin/sh\necho /frai/회복된/경로\n')
    chmodSync(fake, 0o755)
    process.env.SHELL = fake

    expect(await userPath()).toBe('/frai/회복된/경로')
  })

  it('성공한 값은 캐시해 셸을 다시 띄우지 않는다', async () => {
    if (process.platform === 'win32') return

    resetPathCache()
    dir = mkdtempSync(join(tmpdir(), 'frai-shell-'))
    const fake = join(dir, 'fake-shell')
    writeFileSync(fake, '#!/bin/sh\necho /frai/최초/경로\n')
    chmodSync(fake, 0o755)
    process.env.SHELL = fake

    expect(await userPath()).toBe('/frai/최초/경로')

    // 셸을 깨뜨려도 캐시된 성공값이 그대로 나와야 한다.
    process.env.SHELL = '/frai/존재하지-않는/셸'
    expect(await userPath()).toBe('/frai/최초/경로')
  })
})

describe('사용량 기본값', () => {
  it('빈 사용량은 전부 null 이다', () => {
    expect(emptyUsage()).toEqual({
      inputTokens: null,
      outputTokens: null,
      costUsd: null,
      remainingFree: null
    })
  })
})
