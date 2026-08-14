#!/usr/bin/env node
/**
 * 보안 회귀 검사 — Tauri capability 가 하던 방어를 대신한다.
 *
 * ⚠️ 이 검사가 존재하는 이유:
 * Tauri 에서는 `capabilities/default.json` 에 없는 기능을 프론트가 아예 부를 수 없었다.
 * Electron 에는 그런 선언이 없어서, 잘못 쓴 한 줄이 조용히 통과한다. 특히 인공지능이
 * 코드를 생성할 때 학습 데이터에 섞인 옛날 패턴(`nodeIntegration: true`, 렌더러에서
 * 직접 `require('fs')`)을 그대로 내놓기 쉽다. 임의 명령을 실행하는 앱에서 그것은
 * 곧바로 사용자 컴퓨터에 도달하는 구멍이 된다.
 *
 * 새 패키지를 들이지 않고 파일을 직접 훑는다(의존성 최소 원칙).
 * `npm run test:all` 과 배포 스크립트가 이 검사를 통과해야 진행되도록 묶여 있다.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { extname, join, relative } from 'node:path'

const ROOT = new URL('..', import.meta.url).pathname
const SRC = join(ROOT, 'src')

/** 검사 규칙. `where` 에 해당하는 경로에서 `bad` 패턴이 나오면 실패다. */
const RULES = [
  {
    id: 'nodeIntegration',
    where: () => true,
    bad: /nodeIntegration\s*:\s*true/,
    why: 'renderer 에서 Node API 가 열리면 preload 화이트리스트가 무의미해진다.'
  },
  {
    id: 'contextIsolation',
    where: () => true,
    bad: /contextIsolation\s*:\s*false/,
    why: 'preload 와 renderer 가 같은 컨텍스트를 쓰면 노출 API 를 덮어쓸 수 있다.'
  },
  {
    id: 'webSecurity',
    where: () => true,
    bad: /webSecurity\s*:\s*false/,
    why: '동일 출처 정책을 끄면 CSP 를 포함한 방어가 통째로 무너진다.'
  },
  {
    id: 'renderer-node-api',
    where: (p) => p.startsWith('renderer/'),
    bad: /\b(?:require\(\s*['"]node:|from\s+['"]node:|require\(\s*['"](?:fs|child_process|path|os)['"])/,
    why: 'renderer 는 Node API 를 직접 쓰지 않는다. 필요하면 preload 에 채널을 추가하라.'
  },
  {
    id: 'renderer-electron-import',
    where: (p) => p.startsWith('renderer/'),
    bad: /from\s+['"]electron['"]|require\(\s*['"]electron['"]\s*\)/,
    why: 'renderer 는 electron 모듈을 직접 import 하지 않는다. preload 를 통해야 한다.'
  },
  {
    id: 'preload-expose-ipcRenderer',
    where: (p) => p.startsWith('preload/'),
    bad: /exposeInMainWorld\([^)]*ipcRenderer\s*[,)]/,
    why: 'ipcRenderer 를 통째로 노출하면 채널 화이트리스트가 사라진다.'
  },
  {
    id: 'main-logic-imports-electron',
    // main 안에서도 electron 을 아는 파일은 index·ipc·auth/store 셋뿐이다.
    // 나머지가 electron 을 import 하면 창 없이 테스트할 수 없게 된다.
    where: (p) =>
      p.startsWith('main/') &&
      !['main/index.ts', 'main/ipc.ts', 'main/auth/store.ts'].includes(p),
    bad: /from\s+['"]electron['"]|require\(\s*['"]electron['"]\s*\)/,
    why: 'main 로직은 electron 을 몰라야 창을 띄우지 않고 테스트된다(TEST 원칙).'
  }
]

/** 이 파일 자체와 테스트는 패턴 문자열을 담고 있으므로 제외한다. */
const SKIP = /(?:\.test\.ts|check-security\.mjs)$/

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) yield* walk(full)
    else yield full
  }
}

const failures = []
for (const file of walk(SRC)) {
  if (!['.ts', '.js', '.svelte', '.mjs'].includes(extname(file))) continue
  if (SKIP.test(file)) continue

  const rel = relative(SRC, file)
  const text = readFileSync(file, 'utf8')

  for (const rule of RULES) {
    if (!rule.where(rel)) continue
    const lines = text.split('\n')
    for (let i = 0; i < lines.length; i++) {
      // 주석 줄은 넘긴다 — 규칙을 설명하는 문장이 스스로 걸리면 안 된다.
      const line = lines[i]
      if (/^\s*(?:\/\/|\*|\/\*)/.test(line)) continue
      if (rule.bad.test(line)) {
        failures.push({ file: rel, line: i + 1, rule: rule.id, why: rule.why, text: line.trim() })
      }
    }
  }
}

if (failures.length > 0) {
  console.error('❌ 보안 규칙 위반\n')
  for (const f of failures) {
    console.error(`  ${f.file}:${f.line}  [${f.rule}]`)
    console.error(`    ${f.text}`)
    console.error(`    → ${f.why}\n`)
  }
  process.exit(1)
}

console.log(`✅ 보안 검사 통과 (규칙 ${RULES.length}개)`)
