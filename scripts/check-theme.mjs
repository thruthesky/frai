#!/usr/bin/env node
/**
 * 디자인 토큰 구조 검사 — `src/renderer/app.css` 를 파싱한다.
 *
 * ⚠️ 왜 vitest 가 아니라 여기 있나:
 * 이 검사는 CSS **파일**을 읽는다. renderer 안에 두면 `@types/node` 가 없어 타입 검사가
 * 깨지는데, renderer 가 Node 를 모르는 것은 이 프로젝트의 보안 규칙이다(check-security.mjs
 * 의 `renderer-node-import` 규칙). 그래서 `check-security.mjs` 와 형제로 둔다.
 *
 * ⚠️ 이 검사가 존재하는 이유:
 * 라이트/다크 중 한쪽에만 정의된 색 토큰은 **아무 오류도 내지 않는다.** 그냥 그 테마에서만
 * 색이 어긋난 채 조용히 배포된다. 화면을 눈으로 보지 않는 이 프로젝트에서는 이 검사가
 * 그것을 잡는 유일한 수단이다.
 *
 * 🛑 "모든 토큰이 양쪽에 있는가" 로 짜지 말 것 — 치수(`--space-*`·`--r-*`·`--fs-*`)는
 *    **의도적으로 공유**라서 곧바로 오탐이 난다. 색·그림자만 쌍을 요구한다.
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const css = readFileSync(join(root, 'src/renderer/app.css'), 'utf8')

const rootBlock = css.slice(css.indexOf(':root {'), css.indexOf('@media (prefers-color-scheme: light)'))
const lightBlock = (() => {
  const start = css.indexOf('@media (prefers-color-scheme: light)')
  return css.slice(start, css.indexOf('\n}', css.indexOf('}', start + 40)))
})()

const declared = (block) => [...block.matchAll(/^\s*(--[a-z0-9-]+)\s*:/gm)].map((m) => m[1])
const isDimension = (t) => /^--(space|r|fs|fw|lh|ease|dur|titlebar)-?/.test(t)
const isPalette = (t) => t.startsWith('--p-')

/**
 * 라이트에 짝이 없어도 되는 색 토큰.
 * - `--brand-grad` : 랜딩 마크와 같은 그라디언트. 테마가 바뀌어도 브랜드 색은 그대로다.
 * - `--panel`·`--panel-head`·`--input` : `var(--surface-*)` 를 가리키는 레거시 별칭이라
 *   가리키는 대상이 이미 라이트에서 바뀐다. 여기서 또 정의하면 이중 관리가 된다.
 */
const NO_LIGHT_PAIR_OK = new Set(['--brand-grad', '--panel', '--panel-head', '--input'])

const failures = []
const check = (label, ok, detail) => {
  if (ok) console.log(`  ✅ ${label}`)
  else {
    console.log(`  ❌ ${label}\n     ${detail}`)
    failures.push(label)
  }
}

console.log('디자인 토큰 구조 검사')

const rootRoles = declared(rootBlock).filter((t) => !isDimension(t) && !isPalette(t))
const lightRoles = new Set(declared(lightBlock))
const missing = rootRoles.filter((t) => !lightRoles.has(t) && !NO_LIGHT_PAIR_OK.has(t))
check(
  '색·그림자 역할 토큰이 라이트/다크 쌍을 이룬다',
  missing.length === 0,
  `라이트에 짝이 없다: ${missing.join(', ')} — 그 테마에서 색이 어긋난 채 배포된다`,
)

const dimensionInLight = declared(lightBlock).filter(isDimension)
check(
  '치수 토큰은 테마에 따라 갈리지 않는다',
  dimensionInLight.length === 0,
  `라이트가 치수를 덮고 있다: ${dimensionInLight.join(', ')} — 값이 두 벌이 되면 한쪽이 뒤처진다`,
)

const paletteInLight = declared(lightBlock).filter(isPalette)
check(
  '팔레트는 한 벌만 존재한다',
  paletteInLight.length === 0,
  `라이트가 팔레트를 덮고 있다: ${paletteInLight.join(', ')} — "역할 층에서만 전환" 구조가 무너진다`,
)

const overlayOk =
  /--overlay-active:\s*rgb\(255 255 255/.test(rootBlock) &&
  /--overlay-active:\s*rgb\(38 49 72/.test(lightBlock) &&
  rootBlock.includes('--overlay-hover:') &&
  lightBlock.includes('--overlay-hover:')
check(
  '호버·선택 오버레이가 양쪽에 있고 방향이 반대다',
  overlayOk,
  '다크는 흰 막, 라이트는 어두운 막이어야 한다 — 방향이 같으면 한쪽에서 안 보인다',
)

const dropOk =
  /--panel-hover:\s*#[0-9a-f]{6}/i.test(rootBlock) && /--panel-hover:\s*#[0-9a-f]{6}/i.test(lightBlock)
check(
  '칸반 드롭 강조는 오버레이가 아니라 불투명 색이다',
  dropOk,
  '반투명이면 뒤 배경이 비쳐 다른 색이 된다(app.css 주석의 실측 근거)',
)

check('입력 카드 전용 라디우스가 있다', /--r-xl:\s*22px/.test(rootBlock), '--r-xl 22px 가 없다')

if (failures.length > 0) {
  console.error(`\n❌ 토큰 검사 실패 ${failures.length}건`)
  process.exit(1)
}
console.log(`\n✅ 토큰 검사 통과 (검사 6개)`)
