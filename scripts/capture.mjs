#!/usr/bin/env node
/**
 * 화면 캡처 — **창을 화면에 띄우지 않고** 실제 렌더 결과를 PNG 로 저장한다.
 *
 * ⚠️ 이 스크립트가 존재하는 이유:
 * 이 프로젝트는 인공지능이 앱 창을 띄우지 않는 것이 절대 규칙이다. 그래서 "화면이 어떻게
 * 보이는가" 만은 사람에게 확인을 요청할 수밖에 없었는데, **사람에게 확인을 시키는 것 자체가
 * 금지**다(테스트 원칙). 두 규칙이 충돌한 셈이다.
 *
 * `show:false` + `capturePage()` 가 그 모순을 푼다 — 창은 화면에 나타나지 않고
 * (macOS 에서는 Dock 아이콘도 숨긴다) 렌더는 실제로 일어난다. 결과를 인공지능이 직접 보고,
 * 사람에게는 **이미지를 보여주면 된다.**
 *
 * 라이트·다크 두 장을 저장한다.
 */

import { spawn } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const entry = join(root, 'dist/main/index.js')
const outDir = resolve(process.argv[2] ?? join(root, '.captures'))
const TIMEOUT_MS = 90_000

for (const f of ['dist/main/index.js', 'dist/preload/index.cjs', 'dist/renderer/index.html']) {
  if (!existsSync(join(root, f))) {
    console.error(`❌ ${f} 가 없다. 먼저 빌드해야 한다.`)
    process.exit(1)
  }
}
mkdirSync(outDir, { recursive: true })

const electron = createRequire(import.meta.url)('electron')
const env = { ...process.env, FRAI_CAPTURE: outDir, ELECTRON_ENABLE_LOGGING: '1' }
// Electron 바이너리가 Node 로 동작하면 `import { app } from 'electron'` 이 실패한다.
delete env.ELECTRON_RUN_AS_NODE

console.log(`화면 캡처 (창을 띄우지 않는다) → ${outDir}`)

const child = spawn(electron, [entry], { env, stdio: ['ignore', 'pipe', 'pipe'] })
let out = ''
child.stdout.on('data', (d) => (out += d))
child.stderr.on('data', (d) => (out += d))

const timer = setTimeout(() => {
  console.error('❌ 시간 초과 — 렌더가 끝나지 않았다.')
  console.error(out.trim().split('\n').slice(-20).join('\n'))
  child.kill('SIGKILL')
  process.exit(1)
}, TIMEOUT_MS)

child.on('close', (code) => {
  clearTimeout(timer)
  const saved = [...out.matchAll(/\[capture\] (light|dark) → (.+)/g)].map((m) => m[2])
  if (saved.length !== 2 || !out.includes('[capture] 완료')) {
    console.error(`❌ 캡처 실패 (exit=${code})`)
    console.error(out.trim().split('\n').slice(-25).join('\n'))
    process.exit(1)
  }
  for (const f of saved) console.log(`  ✅ ${f}`)
  console.log('\n✅ 캡처 완료')
})
