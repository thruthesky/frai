/**
 * 콘텐츠 보안 정책(CSP) — main 과 renderer 빌드가 **같은 문자열**을 쓰게 하는 단일 출처.
 *
 * ⚠️ 왜 두 군데에 넣는가(중복이 아니다):
 *
 *   개발: `loadURL('http://localhost:1420')` → `onHeadersReceived` 로 응답 헤더에 주입된다.
 *   배포: `loadFile(...)`  → **스킴이 `file://` 이라 헤더 주입이 걸리지 않는다.**
 *
 * 즉 헤더만 쓰면 **정작 배포본에서 CSP 가 0 이 된다.** 이 앱은 LLM 응답을 화면에
 * 그리므로 CSP 부재는 곧 "주입된 스크립트가 preload 를 통해 main 에 도달"로 이어진다.
 * 그래서 빌드 시 `index.html` 에 `<meta http-equiv>` 로도 넣는다.
 * 둘 다 걸리면 브라우저는 **두 정책을 모두** 적용하므로 서로를 약화시키지 않는다.
 *
 * 이 파일은 순수 함수만 둔다 — `electron` 도 `process.env` 도 건드리지 않는다
 * (Vite 설정 파일에서도 그대로 import 해야 하기 때문).
 */

export const DEV_URL = 'http://localhost:1420'
export const DEV_HMR_URL = 'ws://localhost:1421'

export interface CspOptions {
  /** 개발 서버(HMR)를 허용할지. 배포 빌드는 false. */
  dev: boolean
  /** 개발 서버 주소. 기본은 `DEV_URL`. */
  devUrl?: string
  /**
   * renderer 가 직접 연결할 수 있는 추가 출처.
   *
   * 기본값은 **비어 있다.** 릴레이·인증·CLI 호출은 전부 main 에서 나가므로 renderer
   * 에게 외부 도메인을 열어 줄 이유가 없다 — 열어 두면 LLM 응답으로 주입된 스크립트가
   * 데이터를 밖으로 내보내는 통로가 된다(exfiltration).
   */
  connect?: readonly string[]
}

export function cspFor(opts: CspOptions): string {
  const devUrl = opts.devUrl ?? DEV_URL
  const connect = [
    "'self'",
    ...(opts.dev ? [devUrl, DEV_HMR_URL] : []),
    ...(opts.connect ?? [])
  ].join(' ')

  // ⚠️ `file:` 을 명시적으로 넣는 이유: 배포본은 `file://` 에서 로드되는데, 그 경우
  // `'self'` 가 opaque origin 으로 해석되어 자기 자원(js·css)까지 막힐 여지가 있다.
  // 로컬 앱 자원을 허용할 뿐이므로 보안 손실은 없다(외부 http(s) 는 여전히 막힌다).
  const selfSrc = opts.dev ? "'self'" : "'self' file:"

  return [
    `default-src ${selfSrc}`,
    // 🛑 script 에 `unsafe-inline`·`unsafe-eval` 을 넣지 않는다. Svelte 를 컴파일해
    //    쓰는 이유 중 하나가 이것이다. 개발 모드도 예외로 두지 않는다 — Vite 는
    //    모듈 스크립트를 파일로 서빙하므로 인라인 허용 없이 동작한다.
    `script-src ${selfSrc}`,
    // style 만 `unsafe-inline` 을 허용한다.
    // 근거: Svelte 의 transition·animation 은 런타임에 keyframe 을 만들어
    // `document.head` 에 `<style>` 로 주입하고 요소의 `style` 속성을 직접 쓴다.
    // 이걸 막으면 애니메이션이 조용히 깨진다. 스타일 주입은 스크립트 실행으로
    // 이어지지 않으므로 `script-src` 를 조인 상태에서는 위험도가 낮다.
    `style-src ${selfSrc} 'unsafe-inline'`,
    `img-src ${selfSrc} data: blob:`,
    `font-src ${selfSrc} data:`,
    `connect-src ${connect}`,
    "object-src 'none'",
    `base-uri ${selfSrc}`,
    "frame-ancestors 'none'",
    "form-action 'none'"
  ].join('; ')
}
