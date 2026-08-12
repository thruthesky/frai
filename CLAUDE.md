# FRAI

- 명칭: FRAI 는 Free 와 AI 를 합친 단어이다.
- 목적: Frai 는 무료로 인공지능 개발 툴을 쓸 수 있게하는 것입니다. 만약 무료가 어렵다면 최대한 저렴한 비용으로 인공지능을 쓸 수 있는 길을 안내하고자 하는 툴입니다.
- 방식: BYOK(Bring Your Own Key). 사용자가 자신의 API 키를 등록해 사용하며, 대화 기록은 서버가 아닌 사용자 로컬 디스크에 저장된다. 운영 서버가 없으므로 운영 비용이 0 이고, 이것이 "무료"라는 목적을 성립시키는 구조적 근거다.
- 대상 OS: **macOS 전용** (Windows/Linux 는 현 단계에서 고려하지 않는다.)


## 기술 스택

- Tauri v2 + Svelte5 + Vite 로 인공지능 개발 툴을 데스크톱 응용프로그램으로 개발한다.

| 항목 | 선택 |
|---|---|
| 셸 | Tauri v2 |
| 백엔드 | Rust |
| 프론트엔드 | Svelte 5 + Vite (**SvelteKit 사용 안 함**) |
| DB | SQLite (`tauri-plugin-sql`) |
| 키 저장 | OS 키체인 (macOS Keychain) |

### 프론트엔드 규칙

- **Svelte 5 runes 문법만 사용한다.** `$state`, `$derived`, `$effect`, `$props`.
  - Svelte 4 문법(`export let`, `$:` 반응형 선언)은 사용 금지.
  - 웹 검색 결과에 Svelte 4 자료가 다수 섞여 있다. 코드를 참고할 때 반드시 5 문법인지 확인할 것.
- **SvelteKit 을 도입하지 않는다.** 단일 창 앱이라 라우터가 불필요하고, SSR 을 끄는 설정(`ssr = false`, `adapter-static`)이 오히려 부담이다. `npm create vite@latest -- --template svelte` 기준의 순수 Svelte + Vite 구성을 유지한다.
- **의존성을 최소로 유지한다.** 패키지를 추가할 때마다 공급망 공격 표면이 늘어난다. 추가 전에 "직접 20줄 짜면 되는가"를 먼저 검토한다. `package-lock.json` 은 반드시 커밋한다.


## 지침

- 한번에 여러 세션을 바둑판 형태로 펼쳐놓고 각각의 다른 인공지능을 선택해서 작업을 할 수 있도록 합니다.

### 바둑판(그리드) 멀티 세션이 설계에 미치는 영향

이 기능이 FRAI 의 차별점이며, 동시에 기술적으로 가장 어려운 부분이다. 아래를 전제로 설계한다.

- **동시 스트리밍이 기본이다.** N 개 세션이 동시에 토큰을 받는다. Rust 쪽에서 세션별로 독립적인 비동기 태스크와 취소 핸들을 관리하고, 프론트로 emit 하는 이벤트에 **세션 ID 를 반드시 포함**한다. 전역 단일 스트림 채널로 설계하면 나중에 갈아엎어야 한다.
- **렌더 성능이 실제 병목이 된다.** 세션 하나가 부드러워도 6~9 개가 동시에 스트리밍되면 무너진다. 처음부터 다음을 적용한다.
  - 완결된 메시지는 재렌더를 차단한다 (스트리밍 중인 마지막 메시지만 갱신).
  - 마크다운 증분 파싱. 청크마다 전체 문서를 재파싱하지 않는다.
  - 메시지 목록 가상 스크롤.
  - 코드 하이라이트는 스트리밍 중에는 미루고 메시지 완결 후 1회 수행한다.
- **세션마다 프로바이더·모델이 다르다.** 프로바이더 추상화가 선택이 아니라 필수 전제가 된다.
- **레이아웃은 단일 창 안의 CSS Grid 로 구현한다.** 세션마다 별도 OS 창을 띄우는 방식은 상태 동기화와 창 관리 비용이 커진다.
- 그리드 배치(2x2, 3x2 등), 세션 추가/제거, 특정 세션 최대화(포커스 모드)를 고려한다.
- **같은 질문을 여러 AI 에 동시에 던지고 답을 나란히 비교하는 흐름**이 이 UI 의 핵심 가치다. 브로드캐스트 입력(한 번 입력 → 선택한 세션들에 동시 전송)을 기능 후보로 둔다.


## "무료 / 저렴" 목적의 구현 전략

목적이 무료·저가인 이상, 프로바이더 선택은 기능이 아니라 제품의 정체성이다.

- **로컬 모델(Ollama)을 1급 시민으로 취급한다.** 완전 무료 경로이므로 후순위 옵션이 아니라 초기부터 지원 대상이다.
- **무료 티어 및 저가 경로를 조사해 앱 안에서 안내한다.** OpenRouter 의 무료 모델, Google AI Studio, Groq 등이 후보다. 단, 각 서비스의 무료 정책은 수시로 바뀌므로 **문서에 단정적으로 박지 말고 구현 시점에 반드시 재확인**한다.
- **비용 가시화가 핵심 기능이다.** 요청별 토큰 사용량과 예상 비용을 표시하고, 세션·기간 단위로 누적 집계한다. "최대한 저렴하게"라는 목적은 사용자가 비용을 볼 수 있어야 달성된다. 그리드 UI 와 결합하면 **같은 질문에 대한 모델별 비용·품질 비교**가 되며, 이것이 FRAI 만의 강점이 된다.
- **API 키 발급 안내를 온보딩에 포함한다.** 한국어 사용자 기준으로 각 프로바이더의 키 발급 절차를 앱 안에서 단계별로 안내한다. BYOK 앱의 가장 큰 진입 장벽이 이 지점이다.


## 보안 원칙 (반드시 준수)

이 앱은 사용자의 API 키와 전체 대화 기록을 다룬다. 편의를 위해 완화할 수 없는 규칙이다.

### 1. API 키는 웹뷰에 절대 올리지 않는다

- 모든 LLM API 호출은 **Rust 쪽에서** 수행한다. 프론트엔드에서 `fetch` 로 직접 API 를 호출하지 않는다.
- 키는 OS 키체인에 저장하고 읽는 주체도 Rust 다. 키 값을 프론트로 반환하는 Tauri 명령을 만들지 않는다.
- 프론트에는 "키가 등록되어 있는가(boolean)", "키 마지막 4자리" 정도만 노출한다.
- `localStorage`, 설정 JSON 파일, 로그에 키를 쓰지 않는다.

### 2. CSP 에 `unsafe-eval` / `unsafe-inline` 을 넣지 않는다

- Svelte 를 빌드해 쓰는 이유 중 하나가 이것이다. 컴파일 결과물은 `new Function` 을 쓰지 않으므로 CSP 를 기본값 그대로 조일 수 있다.
- 왜 중요한가: 이 앱은 외부(LLM 응답)에서 온 텍스트를 HTML 로 변환해 DOM 에 넣는다. 여기서 스크립트 주입이 성공하면 그 스크립트가 Tauri IPC 를 통해 Rust 명령에 도달할 수 있다. 일반 브라우저의 XSS 보다 심각도가 높다.
- 어떤 라이브러리가 `unsafe-eval` 을 요구한다면 그 라이브러리를 쓰지 않는 쪽을 선택한다.

### 3. LLM 응답 렌더링은 반드시 sanitize 를 거친다

- 마크다운 → HTML 변환 결과를 sanitize 없이 DOM 에 삽입하지 않는다.
- Svelte 의 `{@html ...}` 는 **sanitize 를 통과한 문자열에만** 사용한다. 사용처를 전용 컴포넌트 한 곳으로 모으고 그 외에서는 쓰지 않는다.
- 코드 하이라이트 결과도 예외가 아니다.
- 이미지·링크의 URL 스킴을 검증한다 (`javascript:`, `data:` 차단).

### 4. Tauri permission 을 최소 권한으로 유지한다

- Tauri v2 의 capability/permission 설정에서 프론트가 호출 가능한 명령을 명시적으로 최소화한다. 기본 허용에 기대지 않는다.
- 이것이 3번이 뚫렸을 때의 마지막 방어선이다. **CSP 와 sanitize 는 뚫릴 수 있다고 가정하고 설계한다.**

### 5. 대화 데이터는 로컬을 벗어나지 않는다

- 텔레메트리·크래시 리포트·분석 도구에 대화 내용이 포함되지 않도록 한다.
- 이 사실을 사용자에게 문서로 명시한다. 제품의 셀링 포인트이기도 하다.


## 아키텍처 원칙

- **프로바이더 추상화를 처음부터 둔다.** 확장 순서: Anthropic → OpenAI → Google Gemini → Ollama(로컬) → OpenRouter. 단 "무료" 목적상 Ollama 와 OpenRouter 의 우선순위를 상황에 따라 앞당길 수 있다.
- **스트리밍은 Rust 에서 SSE 를 파싱해 프론트로 이벤트를 emit 한다.** 프론트는 `listen()` 으로 청크를 받는다. 이 구조여야 CORS 문제가 없고 키가 웹뷰에 노출되지 않는다.
- **모든 스트리밍 이벤트는 세션 ID 로 구분된다.** (그리드 멀티 세션 전제)
- 세션별 중단(cancel), 재시도, 에러 상태를 독립적으로 관리한다. 한 세션의 실패가 다른 세션에 영향을 주지 않아야 한다.


## 디렉토리 구조 (예정)

```
src-tauri/
  src/
    main.rs
    providers/     # anthropic.rs, openai.rs, gemini.rs, ollama.rs, openrouter.rs
    session.rs     # 세션별 스트리밍 태스크·취소 핸들 관리
    secrets.rs     # OS 키체인 래핑
    db.rs          # SQLite
src/               # Svelte 5 소스
  main.js
  App.svelte
  lib/
```


## 배포

### 확정 사항

- **Mac App Store 를 사용하지 않는다. DMG 를 홈페이지에서 직접 배포한다.** (확정)
  - 근거: App Store 는 샌드박스가 강제되어 **로컬 프로세스 실행과 임의 경로 파일 접근이 막힌다.** 이는 "무료" 목적의 핵심인 **Ollama 연동**과 v0.2 의 **MCP 서버 실행** 양쪽을 모두 불가능하게 만든다.
- **배포 주소: https://getpes.com/frai/**
- **macOS 전용.** Apple 개발자 등록 완료 상태. Universal binary(`aarch64-apple-darwin` + `x86_64-apple-darwin`)로 빌드한다.
- Windows 코드서명 인증서가 불필요하므로 파이프라인 구축 비용이 낮다. GitHub Actions 매트릭스 없이 로컬 맥 빌드로 충분하다.

### 형제 프로젝트 PES 와의 관계

`https://getpes.com` 은 형제 프로젝트이며 **`~/apps/pes`** 에 있다. FRAI 의 배포 창구를 제공한다.

| 항목 | 값 |
|---|---|
| PES 저장소 | `~/apps/pes` (SvelteKit 웹앱, `web/`) |
| 프로덕션 서버 | `187.52.114.102` (root SSH), 서버 경로 `/root/pes` |
| 구성 | Docker Compose — `web`(SvelteKit adapter-node) · postgres · centrifugo · redis |
| HTTPS | 공용 Caddy(`/root/proxy`), 사이트 규칙 `proxy/sites/getpes.com.caddy` |
| 배포 방식 | 로컬 → 서버 rsync (상세: `~/apps/pes/DEPLOY.md`) |
| 정적 파일 | `web/static/` → 사이트 루트로 서빙 (선례: `install.sh` → `https://getpes.com/install.sh`) |
| 대용량 바이너리 | **Cloudflare R2** — 계정 `70b4907b0a7e06ebac7c869f8c6575fb`, 버킷 `pes-models`, 업로드 스크립트 `scripts/r2-put.py` |

**FRAI 는 PES 와 별도의 git 저장소로 관리한다.** 랜딩 페이지만 PES 쪽에 두고, 앱 소스와 빌드 산출물은 FRAI 저장소·R2 에 둔다.

### 바이너리 배포 경로 — FAI 선례를 따른다

PES 는 이미 대용량 바이너리(모델 체크포인트)를 다루는 확립된 패턴이 있다 (`~/apps/pes/docs/fai-release.md`). FRAI 도 동일하게 간다.

- **DMG 등 바이너리는 서버가 아니라 Cloudflare R2 에 올린다.** DMG 는 수십~수백 MB 이므로 git 저장소나 `web/static/` 에 넣지 않는다.
- **업로드는 오너 로컬 컴퓨터에서만 수행한다.** R2 자격증명(`R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`)을 서버에 두지 않는다.
- `~/apps/pes/scripts/r2-put.py` 를 재사용하거나 참고한다.
- R2 버킷의 공개 접근 방식(공개 `r2.dev` URL vs 커스텀 도메인)은 **구현 시 확인 후 확정한다.** Cloudflare 에 도메인이 있으므로 `dl.getpes.com` 같은 서브도메인 연결이 깔끔하다.

### 랜딩 페이지 (`https://getpes.com/frai/`)

- Caddy 기본 라우팅에 의해 `/frai/*` 는 `pes-web:3000`(SvelteKit)이 처리한다. 별도 프록시 규칙 추가는 불필요하다.
- ⚠️ **PES 저장소에서 작업할 때는 PES 의 규칙이 적용된다.** 특히 **"화면에 보이는 모든 문장은 7개 국어(en·ko·ja·zh·hi·bn·ur) 번역" 절대 규칙**이 랜딩 페이지에도 적용된다. 작업 전 `~/apps/pes/CLAUDE.md` 와 `~/apps/pes/docs/i18n.md` 를 반드시 읽는다.
- **랜딩 페이지에 버전·다운로드 URL 을 하드코딩하지 않는다.** R2 의 릴리스 JSON 을 fetch 해서 표시한다. 그래야 **FRAI 새 버전 배포에 PES 재배포가 필요 없다.** (브라우저에서 fetch 하므로 R2 버킷에 CORS 설정이 필요하다.)

### 자동 업데이트 — 주의할 점

- `tauri-plugin-updater` + 정적 JSON 매니페스트(`latest.json`)를 R2 에 둔다.
- ⚠️ **업데이터가 받는 아티팩트는 DMG 가 아니다.** macOS 업데이터는 **`Frai.app.tar.gz` + `Frai.app.tar.gz.sig`** 를 사용한다. DMG 는 사용자가 처음 설치할 때만 쓴다. 릴리스마다 **두 종류를 모두** 올려야 한다.
- ⚠️ **Tauri 업데이터 서명과 Apple 코드서명은 완전히 별개다.**
  - Apple 코드서명·공증: `APPLE_ID`, `APPLE_PASSWORD`(앱 전용 암호), `APPLE_TEAM_ID` 환경변수 → `tauri build` 가 서명·공증·staple 까지 처리.
  - Tauri 업데이터 서명: `tauri signer generate` 로 minisign 키쌍 생성. 공개키는 `tauri.conf.json` 에 넣고, **비밀키는 절대 저장소에 커밋하지 않는다.**

### 릴리스 절차 (예정)

1. 로컬에서 `tauri build` (서명·공증 포함) → DMG + `.app.tar.gz` + `.sig` 생성
2. R2 에 세 파일 업로드
3. `latest.json` 갱신 후 R2 업로드
4. 랜딩 페이지는 자동으로 새 버전을 표시한다 (PES 재배포 불필요)


## 미결정 사항

- 그리드 세션의 대화 컨텍스트 공유 방식 — 세션마다 완전히 독립인지, 컨텍스트를 복제·전달할 수 있는지.
- R2 버킷 구성 — `pes-models` 버킷에 `frai/` 프리픽스로 넣을지, FRAI 전용 버킷을 새로 만들지.
- 랜딩 페이지 구현 형태 — SvelteKit 라우트(`web/src/routes/frai/`, 7개 국어 규칙 적용) vs 정적 파일(`web/static/frai/`, i18n 없이 간단).


## 로드맵

- **v0.1 (MVP)**
  1. Tauri v2 + Svelte 5 프로젝트 생성, CSP 설정, 서명/공증/자동업데이트까지 동작하는 빈 창 (1~2일)
  2. 키체인 저장 + Anthropic SSE 스트리밍 채팅 (단일 세션)
  3. **그리드 멀티 세션** + 세션별 프로바이더 선택. 프로바이더 2~3개 추가
  4. SQLite 대화 저장·검색, 마크다운/코드 렌더링(sanitize 포함), 토큰·비용 표시
- **v0.2** — MCP(stdio) 클라이언트. `rmcp` 크레이트 사용. 프로토콜 자체보다 **권한 동의 UI, 툴 호출 루프, 서버 크래시 복구, stderr 로그 뷰**가 실제 비용이므로 MVP 에 넣지 않는다.
