#!/usr/bin/env node
/**
 * main 프로세스 기동 스모크 — **빌드한 앱이 실제로 켜지는지** 확인한다.
 *
 * ⚠️ 이 검사가 존재하는 이유 (2026-08-22 실측 사고):
 * 타입 검사도, 보안 규칙도, 유닛 테스트 105개도 **번들을 실제로 로드하지 않는다.**
 * 그래서 Vite 가 `new URL('.', import.meta.url)` 을 에셋으로 오인해 소스를 `data:` URL 로
 * 인라인해 버린 사고를 **하나도 잡지 못했다** — 빌드는 성공하고, 앱을 켜는 순간
 * `ERR_INVALID_URL_SCHEME` 로 죽었다. 사람이 앱을 실행해서야 발견됐다.
 *
 * 그런 일이 다시 없도록, 여기서 **Electron 을 실제로 띄운다.**
 * 창은 만들지 않는다(`FRAI_SMOKE_EXIT=1` → main/index.ts 가 창 생성만 건너뛴다).
 * macOS 에서는 Dock 아이콘도 숨기므로 사람 화면을 조금도 건드리지 않는다.
 */

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const entry = join(root, 'dist/main/index.js')
const TIMEOUT_MS = 60_000

if (!existsSync(entry)) {
  console.error(`❌ ${entry} 가 없다. 먼저 \`npm run build\` 를 실행하라.`)
  process.exit(1)
}
// preload·renderer 도 함께 있어야 실제 기동과 같은 조건이 된다.
for (const f of ['dist/preload/index.cjs', 'dist/renderer/index.html']) {
  if (!existsSync(join(root, f))) {
    console.error(`❌ ${f} 가 없다. \`npm run build\` 로 전체를 빌드하라.`)
    process.exit(1)
  }
}

const electron = createRequire(import.meta.url)('electron')

console.log('main 기동 스모크 (창을 띄우지 않는다)')

const env = { ...process.env, FRAI_SMOKE_EXIT: '1', ELECTRON_ENABLE_LOGGING: '1' }

// 🛑 `ELECTRON_RUN_AS_NODE` 를 반드시 지운다.
//    이 변수가 켜져 있으면 Electron 바이너리가 **평범한 Node 로 동작**해서
//    `import { app } from 'electron'` 이 "does not provide an export named" 로 죽는다.
//    앱 결함처럼 보이지만 실제로는 실행 환경 문제다 — 일부 개발 도구·터미널이 이 변수를
//    켜 두므로(2026-08-22 실측: 이 작업 환경에 `=1` 로 설정돼 있었다) 여기서 명시적으로 끈다.
delete env.ELECTRON_RUN_AS_NODE

const child = spawn(electron, [entry], { env, stdio: ['ignore', 'pipe', 'pipe'] })

let out = ''
let died = false

/**
 * Electron 은 로드 실패 후에도 프로세스가 남아 있는 경우가 있다. 타임아웃까지
 * 기다리면 60초를 버리므로, 치명적 신호가 보이면 즉시 끊는다.
 */
const FATAL = [/App threw an error during load/, /^[A-Za-z]*Error(\s|:)/m, /ERR_[A-Z_]+/]
const watch = (chunk) => {
  out += chunk
  if (died) return
  if (FATAL.some((re) => re.test(String(chunk)))) {
    died = true
    setTimeout(() => child.kill('SIGKILL'), 300) // 남은 스택을 마저 받는다
  }
}
child.stdout.on('data', watch)
child.stderr.on('data', watch)

const timer = setTimeout(() => {
  console.error(`❌ ${TIMEOUT_MS / 1000}초 안에 끝나지 않았다 — 어딘가에서 멈춰 있다.`)
  console.error(out.trim().split('\n').slice(-20).join('\n'))
  child.kill('SIGKILL')
  process.exit(1)
}, TIMEOUT_MS)

child.on('close', (code) => {
  clearTimeout(timer)

  const ok = out.includes('[smoke] main 초기화 성공') && !died
  if (!ok || code !== 0) {
    console.error(`❌ main 이 정상적으로 기동하지 못했다 (exit=${code})`)
    console.error('─── 출력 ───')
    console.error(out.trim().split('\n').slice(-25).join('\n'))
    console.error(
      '\n이 실패는 "빌드는 되는데 앱이 안 켜지는" 상태를 뜻한다. 타입·테스트가 전부\n' +
        '통과해도 여기서 걸리면 배포하면 안 된다.',
    )
    process.exit(1)
  }

  console.log('  ✅ 모듈 로드 · IPC 등록 · 메뉴 · 업데이터 배선 통과')
  console.log('\n✅ main 기동 스모크 통과')
})
