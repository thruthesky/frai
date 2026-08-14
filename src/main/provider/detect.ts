/**
 * 설치된 CLI 탐지 + GUI 앱의 PATH 문제 해결.
 *
 * ⚠️ 이 파일이 존재하는 이유:
 * macOS 에서 `.app` 번들로 실행된 GUI 앱은 사용자의 셸 PATH 를 **상속받지 않는다.**
 * 개발 머신에서 실측한 결과 대상 CLI 5개가 전부 GUI 기본 PATH 밖에 있었다.
 *   claude/codex → ~/.local/bin,  opencode → ~/.nvm/.../bin,
 *   grok → ~/.grok/bin,  kimi → ~/.kimi-code/bin
 * 경로를 하드코딩하면 반드시 깨진다(nvm 은 노드 버전이 바뀌면 경로가 바뀐다).
 * 반드시 로그인 셸에서 PATH 를 받아와야 한다.
 *
 * ⚠️ 개발 모드(`npm run dev`)로는 이 문제가 재현되지 않는다. 개발 실행은 터미널
 * PATH 를 그대로 물려받기 때문이다. 검증은 반드시 패키징된 앱으로 한다.
 *
 * ⚠️ Windows 는 사정이 다르다 — GUI 앱도 시스템/사용자 PATH 를 정상 상속하므로
 * 로그인 셸 조회가 불필요하고, 대신 확장자(PATHEXT)를 붙여 찾아야 한다.
 *
 * 이 파일은 `electron` 을 import 하지 않는다(창 없이 테스트 가능해야 한다).
 */

import { execFile } from 'node:child_process'
import { accessSync, constants, statSync } from 'node:fs'
import { delimiter, join } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export const isWindows = process.platform === 'win32'

/** CLI 의 출력 해석 방식. */
export type OutputFormat = 'claudeStreamJson' | 'plainText'

export interface CliSpec {
  id: string
  bin: string
  label: string
  args: readonly string[]
  format: OutputFormat
  /**
   * 실제로 옵션·출력 형식을 확인했는가.
   * false 면 UI 에 "실험적"으로 표시하고, 구현 전 `--help` 로 반드시 재확인한다.
   */
  verified: boolean
}

/**
 * 지원 대상 CLI 목록.
 *
 * `claude` 만 실제 출력을 확인해 구현했다. 나머지는 잠정값이며 `verified: false` 다.
 * 각 CLI 를 정식 지원할 때는 반드시 `<bin> --help` 로 인자와 출력 형식을 먼저 확인하고
 * 여기 값을 고친 뒤 `verified` 를 올린다. 추측으로 채우지 않는다.
 */
export const CLI_SPECS: readonly CliSpec[] = [
  {
    id: 'claude',
    bin: 'claude',
    label: 'Claude Code',
    args: ['-p', '--output-format', 'stream-json', '--verbose'],
    format: 'claudeStreamJson',
    verified: true
  },
  { id: 'codex', bin: 'codex', label: 'Codex', args: [], format: 'plainText', verified: false },
  { id: 'opencode', bin: 'opencode', label: 'opencode', args: [], format: 'plainText', verified: false },
  { id: 'grok', bin: 'grok', label: 'Grok', args: [], format: 'plainText', verified: false },
  { id: 'kimi', bin: 'kimi', label: 'Kimi', args: [], format: 'plainText', verified: false }
]

export function cliSpec(id: string): CliSpec | undefined {
  return CLI_SPECS.find((s) => s.id === id)
}

let cachedPath: string | null = null

/**
 * 사용자의 실제 PATH 를 얻는다. 프로세스 수명 동안 1회만 조회한다.
 *
 * macOS·Linux 는 로그인 셸을 거치고, Windows 는 상속된 PATH 를 그대로 쓴다.
 * 실패하면 현재 프로세스의 PATH 로 물러선다(개발 모드에서는 그걸로 충분하다).
 */
export async function userPath(): Promise<string> {
  if (cachedPath !== null) return cachedPath

  const fallback = process.env.PATH ?? ''

  // Windows GUI 앱은 PATH 를 정상적으로 상속한다. 셸을 띄울 이유가 없다.
  if (isWindows) {
    cachedPath = fallback
    return cachedPath
  }

  const shell = process.env.SHELL ?? '/bin/zsh'
  try {
    const { stdout } = await execFileAsync(shell, ['-l', '-c', 'echo $PATH'], { timeout: 10_000 })
    const s = stdout.trim()
    if (s === '') {
      console.warn('로그인 셸이 빈 PATH 를 반환했습니다. 현재 PATH 로 대체합니다.')
      cachedPath = fallback
    } else {
      console.info(`로그인 셸에서 PATH 확보: ${s.split(delimiter).length} 개 항목`)
      cachedPath = s
    }
  } catch (e) {
    console.warn(`로그인 셸(${shell}) 실행 실패: ${String(e)}. 현재 PATH 로 대체합니다.`)
    cachedPath = fallback
  }
  return cachedPath
}

/** 테스트에서 PATH 캐시를 비운다. */
export function resetPathCache(): void {
  cachedPath = null
}

/**
 * PATH 를 뒤져 실행 파일을 찾는다. `which`·`where` 를 부르지 않고 직접 확인한다.
 *
 * Windows 에서는 확장자가 없는 `claude` 가 실제로는 `claude.cmd` 일 수 있어
 * PATHEXT 의 확장자를 차례로 붙여 본다.
 */
export async function findExecutable(bin: string): Promise<string | null> {
  const path = await userPath()
  const exts = isWindows
    ? (process.env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean)
    : ['']

  for (const dir of path.split(delimiter).filter((d) => d !== '')) {
    for (const ext of exts) {
      const candidate = join(dir, bin + ext)
      if (isExecutable(candidate)) return candidate
    }
  }
  return null
}

function isExecutable(p: string): boolean {
  try {
    if (!statSync(p).isFile()) return false
    // Windows 에는 실행 비트가 없다 — PATHEXT 로 이미 걸렀으므로 존재하면 실행 가능으로 본다.
    if (isWindows) return true
    accessSync(p, constants.X_OK)
    return true
  } catch {
    return false
  }
}
