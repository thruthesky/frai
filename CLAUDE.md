# FRAI

- 명칭: FRAI 는 Free 와 AI 를 합친 단어이다.
- 목적: Frai 는 무료로 인공지능 개발 툴을 쓸 수 있게하는 것입니다. 만약 무료가 어렵다면 최대한 저렴한 비용으로 인공지능을 쓸 수 있는 길을 안내하고자 하는 툴입니다.
- 방식: BYOK(Bring Your Own Key). 사용자가 자신의 API 키를 등록해 사용하며, 대화 기록은 서버가 아닌 사용자 로컬 디스크에 저장된다. 운영 서버가 없으므로 운영 비용이 0 이고, 이것이 "무료"라는 목적을 성립시키는 구조적 근거다.
- 대상 OS: **macOS 전용** (Windows/Linux 는 현 단계에서 고려하지 않는다.)


## ⚠️ 테스트 원칙 (최우선 · 절대 규칙)

> 📖 **상세 지침: [TEST.md](TEST.md) — 작업 전 반드시 읽는다.**
> 창 없이 검증하는 구조(`EventSink` 클로저화), 테스트 위치, 새 기능 추가 시 규칙이 정리되어 있다.

**규칙은 두 가지다.**

1. **인공지능이 자율적으로 모든 테스트를 수행한다.** 사람 개발자에게 테스트를 요청하지 않는다.
2. **화면에 앱을 띄우지 않고 테스트한다.** 사람의 작업 화면을 빼앗지 않는다.

### 금지

- ❌ "직접 만져보세요" · "확인해 주세요" · "테스트해 보시고 알려주세요" · "잘 되는지 봐 주세요"
- ❌ 앱을 띄워 놓고 사람에게 넘기며 작업을 끝냈다고 보고하는 것
- ❌ 검증하지 않은 것을 "구현 완료" 로 보고하는 것
- ❌ 사람의 확인을 기다리며 다음 작업을 멈추는 것

### 해야 할 일

- ✅ **코드를 고쳤으면 인공지능이 직접 실행해서 결과를 확인한다.** 확인 전에는 완료가 아니다.
- ✅ **검증 수단을 스스로 만든다.** 자동화할 방법이 없어 보이면, 방법을 찾는 것까지가 작업 범위다.
- ✅ **실패하면 실패했다고 그대로 보고한다.** 출력을 함께 붙인다. 되는 척하지 않는다.
- ✅ 사람에게는 **검증이 끝난 결과**만 전달한다.

### 🚫 화면에 띄우지 않고 테스트한다 (테스트 원칙과 동급 · 절대 규칙)

**사람 개발자는 같은 컴퓨터에서 다른 일을 하고 있다.**
인공지능이 자율 작업 중 앱을 반복해서 화면에 띄우면, 사람이 타이핑하던 창에서 포커스가 사라져
**작업이 매우 크게 방해받는다.** 실제로 이 프로젝트에서 그 일이 벌어졌고 그래서 이 규칙이 생겼다.

- ❌ **`osascript` 로 앱을 `frontmost` 로 만드는 것 — 절대 금지**
- ❌ **전체 화면 스크린샷 — 금지** (사람의 작업 내용이 그대로 찍힌다)
- ❌ **테스트를 위해 앱 창을 띄우는 것 — 금지**
- ✅ **모든 검증은 창을 띄우지 않는 수단으로 한다.** `npm run test:all` (타입 → 보안 규칙 → 테스트)
- ✅ 어댑터·상태 로직은 **런타임 없이** 테스트되도록 설계한다.
  (`EventSink` 를 클로저로 두고 main 로직이 `electron` 을 import 하지 않는 이유가 이것이다 — 자식
  프로세스 실행과 HTTP 스트리밍을 **실제로 끝까지 돌리면서도** 앱 창을 띄우지 않는다.)

**"화면에 띄워야만 확인할 수 있다" 는 판단이 들면, 그것은 설계를 고쳐야 한다는 신호다.**
띄울 방법을 찾지 말고, 띄우지 않고 확인되도록 코드를 바꾼다.

**앱 실행(`npm run dev`)은 사람이 직접 볼 때만 한다.** 인공지능은 검증 목적으로 실행하지 않는다.

### 🚫 로컬 DB·로컬 Docker 를 쓰지 않는다 — **원격 getpes.com 서버를 직접 액세스한다**

**DB 가 필요한 작업은 로컬 postgres 나 로컬 Docker 를 띄우지 않는다. 반드시 원격 프로덕션 서버(getpes.com)에 직접 접속해서 개발·검증한다.**

- ❌ `docker compose up postgres` 로 로컬 DB 기동 — 금지
- ❌ **Docker Desktop 실행 — 금지** (화면에 앱이 떠서 사람의 작업을 방해한다)
- ❌ 로컬 DB 가 없다는 이유로 "검증 불가" 라고 보고하는 것 — 금지
- ✅ **SSH 터널로 원격 DB 에 직접 붙어서 실제로 돌린다.**

```bash
# 1. 원격 DB 비밀번호 확보 (값은 출력하지 않는다)
PG_PW=$(ssh root@187.52.114.102 "grep -E '^PG_PW=' /root/pes/.env | cut -d= -f2-" | tr -d '"'"'"' \r\n')

# 2. SSH 터널 — 원격 postgres 는 127.0.0.1:5433 에만 바인딩되어 외부에 열려 있지 않다
ssh -f -N -L 15433:127.0.0.1:5433 root@187.52.114.102

# 3. 이 URL 로 마이그레이션·테스트를 돌린다
export DATABASE_URL="postgres://pes:${PG_PW}@127.0.0.1:15433/pes"
cd ~/apps/pes/web && pnpm db:migrate                       # 이력 관리되므로 중복 적용 안 됨
DATABASE_URL="$DATABASE_URL" pnpm vitest run src/lib/server/frai

# 4. 끝나면 터널을 닫는다
pkill -f "ssh -f -N -L 15433:"
```

**⚠️ 이것은 프로덕션 DB 다. 다음을 반드시 지킨다.**

- 테스트는 **임시 uid(`test-frai-*`)를 만들고 `afterAll` 에서 반드시 지운다.**
- 테스트 후 잔여 데이터를 **직접 조회해 0 인지 확인한다.** 확인 전에는 완료가 아니다.
  ```bash
  ssh root@187.52.114.102 "docker exec pes-postgres-1 psql -U pes -d pes -tAc \
    \"select count(*) from web.user_profiles where uid like 'test-frai-%'\""
  ```
- 기존 데이터를 UPDATE·DELETE 하는 테스트를 만들지 않는다. **자신이 만든 행만 건드린다.**
- 스키마 변경은 반드시 **drizzle 마이그레이션**으로 한다. `psql` 로 직접 `ALTER TABLE` 하지 않는다
  (이력이 어긋나면 다음 배포에서 충돌한다).

### 이 프로젝트의 검증 수단

**한 번에 전부 돌리기: `npm run test:all`** (타입 검사 → 보안 규칙 → 테스트 순서)

| 대상 | 명령 | 개수 | 창 뜸? |
|---|---|---|---|
| main 유닛 (stream-json·SSE 파싱, PKCE, CLI 탐지) | `npm run test` | 29 | ❌ |
| main 통합 — 세션→프로바이더→이벤트, **모의 SSE 서버를 실제로 띄움** | `npm run test` (`session.test.ts`) | 8 | ❌ |
| 보안 규칙 (nodeIntegration·contextIsolation·renderer 의 Node API) | `npm run check:security` | 7 규칙 | ❌ |
| 프론트 상태·칸반·이벤트 라우팅 | `npm run test` (vitest, node 환경) | 43 | ❌ |
| 타입 정합성 | `npm run check` (svelte-check + tsc) | 143 파일 | ❌ |
| PES 인증 순수 로직 (redirect_uri·PKCE) | `cd ~/apps/pes/web && pnpm vitest run src/lib/server/frai` | 10 | ❌ |
| **PES 인증 DB 경로** (code 발급→교환→토큰) | 위 + `DATABASE_URL` 을 **원격 터널**로 지정 | 8 | ❌ |

**핵심: 위 전부가 창을 띄우지 않는다(앱 테스트 80개).** `EventSink` 를 클로저로 두고 **main 로직이 `electron` 을 import 하지 않기 때문에**, 어댑터를 실제로 끝까지 돌리면서도(프로세스 spawn, HTTP 스트리밍 포함) Electron 런타임이 필요 없다. **새 기능을 붙일 때도 이 성질을 깨지 않는다** — 방법은 [TEST.md](TEST.md) 4장.

**⚠️ Playwright(Electron) E2E 를 채택하지 않는다.** 창을 띄우기 때문이다. **웹뷰 픽셀 확인에 의존하는 테스트를 만들지 말고**, 검증 대상 로직을 UI 밖으로 빼서 위 수단으로 확인한다.

**⚠️ 사람 손이 반드시 필요한 것(예: 실제 Apple ID 로그인, 유료 결제)이 있다면, 그 항목만 명시하고 나머지는 전부 자동 검증을 끝낸 뒤 보고한다.**

### 자동 검증이 어려운 항목

패키징 빌드본의 CLI PATH · 화면 픽셀 렌더링 · **브라우저에서의 Firebase 로그인 그 자체** 3가지뿐이다.
(로그인 이후의 서버 흐름 — code 발급·PKCE 교환·토큰 검증·폐기 — 은 **원격 DB 로 실제 검증했다.**)
사유와 대안은 [TEST.md](TEST.md) 5장에 정리되어 있다. **이 목록은 짧게 유지한다.**


## 기술 스택

- Electron + Svelte 5 + Vite 로 인공지능 개발 툴을 데스크톱 응용프로그램으로 개발한다.
- **2026-08-14 Tauri v2 에서 Electron 으로 전면 이전했다.** 근거는 `.cowork/migration-to-electron/final-report.md` —
  PTY 터미널·Docker·임의 명령 실행이 필요해졌고(생태계 격차), Windows 를 지원해야 하며(크로미움 단일 렌더),
  인공지능 주도 개발에서 node-pty·dockerode 쪽 학습 데이터가 압도적이기 때문이다.

| 항목 | 선택 |
|---|---|
| 셸 | Electron (main · preload · renderer 3층) |
| 백엔드 | TypeScript (Node, Electron main 프로세스) |
| 프론트엔드 | Svelte 5 + Vite (**SvelteKit 사용 안 함**) |
| DB (대화 내용) | 로컬 SQLite (미구현 — 이전 시 `tauri-plugin-sql` 계획은 폐기) |
| DB (세션 목록) | **getpes.com 과 공유하는 PostgreSQL** — 로그인 시 동기화 |
| 계정 | PES 와 호환 (Firebase Auth → `/api/auth/session`) |
| 키 저장 | Electron `safeStorage` (macOS 키체인 · Windows DPAPI) |

### 프론트엔드 규칙

- **Svelte 5 runes 문법만 사용한다.** `$state`, `$derived`, `$effect`, `$props`.
  - Svelte 4 문법(`export let`, `$:` 반응형 선언)은 사용 금지.
  - 웹 검색 결과에 Svelte 4 자료가 다수 섞여 있다. 코드를 참고할 때 반드시 5 문법인지 확인할 것.
- **SvelteKit 을 도입하지 않는다.** 단일 창 앱이라 라우터가 불필요하고, SSR 을 끄는 설정(`ssr = false`, `adapter-static`)이 오히려 부담이다. `npm create vite@latest -- --template svelte` 기준의 순수 Svelte + Vite 구성을 유지한다.
- **의존성을 최소로 유지한다.** 패키지를 추가할 때마다 공급망 공격 표면이 늘어난다. 추가 전에 "직접 20줄 짜면 되는가"를 먼저 검토한다. `package-lock.json` 은 반드시 커밋한다.

### 개발 환경

| 명령 | 용도 |
|---|---|
| `npm run dev` | 개발 모드 (Vite dev 서버 1420 + Electron 창, HMR 동작) |
| `npm run build` | main · preload · renderer 번들 |
| `npm run dist:mac` / `dist:win` / `dist` | 패키징 (macOS arm64 / Windows x64 / 둘 다) |
| `npm run test:all` | 타입 → 보안 규칙 → 테스트 (창을 띄우지 않는다) |
| `npm run check` | `svelte-check` 타입 검사 |

**⚠️ 개발 포트는 1420 이다. Vite 기본값 5173 을 쓰지 않는다.**

형제 프로젝트 **PES(`~/apps/pes/web`)가 5173 을 사용**하기 때문이다. 두 프로젝트를 동시에 열어두고 개발하면 FRAI 의 Vite 가 조용히 다른 포트로 밀려나고, main 이 여는 URL 은 그대로라서 **FRAI 창에 PES 사이트가 로드된다.** (실제로 겪은 문제다.)

- Vite: `1420`, HMR: `1421` — `vite.renderer.config.ts` 와 `src/main/index.ts` 의 `DEV_URL`·CSP 가 **항상 일치해야 한다.**
- `strictPort: true` 를 설정했다. 포트가 점유되어 있으면 조용히 옮겨가지 않고 **실패한다.** 엉뚱한 사이트가 뜨는 것보다 명확한 실패가 낫기 때문이며, 이 설정을 끄지 않는다.


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
- **같은 질문을 여러 AI 에 동시에 던지고 답을 나란히 비교하는 흐름**이 이 UI 의 핵심 가치다. 브로드캐스트 입력(한 번 입력 → 선택한 세션들에 동시 전송)이 구현되어 있다.

### 두 번째 화면 — 세션 목록 (칸반 보드)

세션이 늘어나면 바둑판만으로는 관리가 안 된다. GitHub Projects 스타일의 칸반 보드로 세션을 **작업 단위처럼** 정렬한다.

- **진입**: 네이티브 메뉴 `보기 → 세션 목록` (⌘2), 또는 타이틀바의 화면 전환 버튼. 바둑판은 ⌘1.
- **새 세션은 항상 `Backlog` 로 들어간다.** 기본 칸은 `Backlog`(고정) · `TODO` · `In progress` · `Done`.
- 칸 추가·이름변경·삭제가 가능하다. **`Backlog` 는 삭제할 수 없다** — 세션이 갈 곳이 없어지면 안 되기 때문이다.
- **칸을 지우면 그 안의 세션은 `Backlog` 로 되돌아간다. 세션을 잃지 않는다.**
- 카드는 HTML5 드래그앤드롭으로 칸 사이를 옮긴다. 외부 DnD 라이브러리를 쓰지 않는다(의존성 최소 원칙).
- 카드에는 세션 제목(첫 질문에서 자동 생성), 프로바이더, 서버경유/로컬 배지, 상태, 메시지 수를 보여준다.


## 프로바이더 전략 — "무료 / 저렴" 목적의 구현

목적이 무료·저가인 이상, 프로바이더 선택은 기능이 아니라 제품의 정체성이다. FRAI 는 **네 가지 경로**를 지원한다.

### 경로 0. 기본 AI — getpes.com 릴레이 ✅ 구현 완료

아무 설정 없이 **즉시, 무료로** 쓸 수 있는 첫 경험을 제공한다. BYOK 앱의 가장 큰 진입 장벽인 "API 키 발급"을 첫 실행에서 제거하는 것이 목적이다.

```
FRAI ──POST──> https://getpes.com/frai/api/chat ──> AKRouter (기본) · DeepSeek · 그 외
     <──SSE──                                   <──   전부 OpenAI Chat Completions 규격
```

- **AI 서비스 API 키는 서버에만 둔다.** 앱에는 절대 내려보내지 않는다.
- **익명 5회/일(기기 ID) · 로그인 20회/일(uid)** + 전역 일일 예산 상한. 초과하면 개인 API 키 등록 또는 CLI 연동으로 안내한다.
- **두뇌는 언제든 갈아끼운다.** 표준은 **OpenAI Chat Completions 프로토콜**이므로 프로바이더 교체는 환경변수 세 개(`FRAI_LLM_PROVIDER`·모델·키)를 바꾸는 일이지 코드를 고치는 일이 아니다. 서버 구현은 `~/apps/pes/web/src/lib/server/llm/` 이며 레지스트리에 akrouter·deepseek·openai·openrouter·ollama 가 들어 있다. 레지스트리 밖은 `FRAI_LLM_BASE_URL` 로 지정한다.
  - ⚠️ 이 규격을 못 맞추는 프로바이더(Anthropic 네이티브 `/v1/messages` 등)는 어댑터를 따로 만든다. 레지스트리에 억지로 끼워 넣지 않는다 — 그러면 "표준"이 의미를 잃는다.

**⚠️ 이 경로는 두 가지 전제를 깬다. 반드시 인지하고 설계한다.**

**1. "운영 서버가 없어 비용이 0" 이라는 전제가 깨진다.**
이제 오너가 DeepSeek API 비용을 직접 부담한다. `deepseek-v4-flash` 단가(USD/1M tokens: 캐시히트 0.0028 · 미스 0.14 · 출력 0.28) 기준으로 요청당 대략 $0.0005 남짓이므로, 사용자 1,000명이 매일 한도를 채우면 **월 수십만 원 규모**가 된다. 따라서:
- **서버측 전역 일일 예산 상한**을 반드시 둔다. 이것이 비용 폭발을 막는 최후 방어선이다.
- 상한에 걸리면 개별 사용자에게는 "오늘은 여기까지" 로 안내하고 다른 경로를 권한다.

**2. "대화는 로컬을 벗어나지 않는다" 는 보안 원칙의 유일한 예외다.**
기본 AI 를 쓰는 동안 대화 내용이 getpes.com 을 지난다. **UI 에 반드시 명시적으로 고지한다.**
- 구현: `ProviderKind::Relay` + `leaves_device: true` → 세션 카드에 "서버 경유" 배지 표시.
- 개인 키·CLI 경로는 "로컬" 배지로 대비를 보여준다. 사용자가 차이를 알고 고르게 하는 것이 정직하다.

**⚠️ 남용 방지가 이 기능의 최대 난제다 (미해결 — 결정 필요).**

데스크톱 앱은 클라이언트를 신뢰할 수 없다. 현재 구현은 익명 기기 ID(`~/Library/Application Support/com.getpes.frai/device-id`)를 헤더로 보내지만, **이것만으로는 막지 못한다:**
- 파일을 지우거나 앱을 재설치하면 새 ID 가 발급된다.
- 앱 바이너리를 뜯어 엔드포인트를 알아내면 **누구나 쓸 수 있는 무료 DeepSeek 프록시**가 된다. 무인증 공개 엔드포인트는 반드시 남용된다.

검토할 대응(택일 또는 조합):
| 방식 | 장점 | 단점 |
|---|---|---|
| PES 계정 로그인 필수 | 가장 확실. PES 에 인증이 이미 있다 | "즉시" 라는 목적과 충돌 |
| 익명 소량(예: 5회) → 로그인 시 20회 | "즉시" 와 남용 억제를 절충 | 구현이 두 갈래 |
| 서버 전역 일일 상한 | 비용 폭발 차단 | 남용 자체는 못 막음 (필수 병행) |

**✅ 확정: "익명 소량 + 로그인 시 전량" + 전역 상한.**

| 상태 | 기본 AI 무료 한도 | 세션 목록 |
|---|---|---|
| 익명(로그인 안 함) | **5회/일** (기기 ID 기준) | 로컬에만 저장 |
| PES 계정 로그인 | **20회/일** (uid 기준) | getpes.com DB 동기화 |

- 로그인이 실질적인 남용 방지 장치가 된다. 익명 한도를 낮게 유지해 "재설치로 무한 리셋" 의 이득을 줄인다.
- **서버 전역 일일 예산 상한은 별도로 반드시 둔다.** 위 두 장치가 뚫려도 비용은 막아야 한다.

### 릴레이 API 규약 (FRAI ↔ getpes.com) — ✅ 양쪽 구현 완료

클라이언트는 `src/main/provider/relay.ts`, 서버는 `~/apps/pes/web/src/routes/frai/api/chat/+server.ts` 다.

```
POST /frai/api/chat
X-Frai-Device: <익명 기기 UUID>
X-Frai-Version: <앱 버전>
Authorization: Bearer <FRAI 토큰>     ← 있을 때만. 로그인 쿼터(20회)를 받는다
{ "messages": [{"role":"user","content":"..."}] }

← 200 text/event-stream
data: {"type":"chunk","text":"부분 응답"}
data: {"type":"done","usage":{"inputTokens":1,"outputTokens":2,"costUsd":0.0001,"remainingFree":19}}
data: {"type":"error","message":"..."}
data: [DONE]

← 400  messages 형식 오류 · 익명인데 기기 ID 없음
← 401  Authorization 이 있는데 무효 (⚠️ 익명으로 강등하지 않는다)
← 429  일일 한도 초과 · 전역 예산 소진 (앱이 다른 경로로 안내한다)
← 503  동시 스트림 포화 · 서버 AI 설정 미완 (잠시 뒤 다시 되는 상황이라 429 를 쓰지 않는다)
```

**서버 쪽 요점** (`web/src/lib/server/llm/` · `web/src/lib/server/frai/quota.ts`)

- **시스템 프롬프트는 FRAI 전용**이다. PES 의 `SYSTEM_PROMPT`(라리아 학습 도우미)를 재사용하지 않는다 — 그쪽은 모든 답변 끝에 【음성요약】을 강제해서 코드 블록 뒤에 잡음이 붙는다.
- **입력 상한**: 메시지 40개 · 총 32KiB · 응답 토큰 상한. 업스트림을 부르기 **전에** 막는다. `role: "system"` 은 클라이언트가 넣을 수 없다(페르소나 교체 우회 차단).
- **쿼터는 원자적**이다 — `INSERT ... ON CONFLICT DO UPDATE ... WHERE requests < limit`. "읽고 나서 쓰기" 로 나누면 동시 요청이 둘 다 통과한다.
- **전역 예산은 soft cap** 이다. 비용은 응답이 끝나야 알 수 있어 사전 예약이 불가능하다. 그 오버슈트를 동시 스트림 상한이 좁힌다.
- **요청별 원장(`web.frai_relay_requests`)을 남긴다.** 집계만 남기면 "한 요청이 실제로 얼마를 쓰는가" 를 나중에 소급할 수 없다.
- 클라이언트가 끊으면 `ReadableStream.cancel()` 에서 업스트림을 abort 한다(비용 누수 차단).
- 검증: `cd ~/apps/pes/web && npx vitest run src/lib/server/frai src/lib/server/llm` (DB 는 원격 터널 필요, 없으면 통합분은 스킵)
- **실서버 스모크**: `FRAI_SMOKE_URL=... npm run test` (`src/main/relay-smoke.test.ts`) — 평소엔 스킵되고, 환경변수를 주면 앱 코드가 실제 서버를 때린다.

- `remainingFree` 를 매 응답에 실어 보낸다. 앱이 남은 횟수를 표시해 초과 전에 대비하게 한다.
- 서버는 PES SvelteKit 라우트로 구현한다. SSE 스트리밍 선례: `~/apps/pes/web/src/routes/api/chat/[roomId]/messages/+server.ts`
- 일일 쿼터 선례: `~/apps/pes/web/src/lib/server/fai/service.ts` (단, 그쪽은 로그인 uid 기준이다)
- ⚠️ PES `web` 컨테이너는 단일 Node 프로세스다. SSE 연결이 오래 유지되므로 **동시 접속이 이벤트 루프를 막지 않는지** 확인한다. PES 가 실시간 채팅을 Centrifugo 로 분리한 것과 같은 이유다.

### 경로 1. 설치된 CLI 연동 (최우선 — 가장 강력한 무료 수단)

사용자 컴퓨터에 이미 설치된 AI CLI 를 FRAI 안에서 구동한다. 대상: **`claude`, `codex`, `opencode`, `grok`, `kimi`** 등.

- **왜 최우선인가:** 이미 **Claude Pro/Max·ChatGPT Plus 등을 구독 중인 사용자는 추가 API 비용 없이** 그 요금제를 그대로 쓸 수 있다. 종량제 API 키보다 훨씬 저렴하거나 사실상 무료다. "무료로 인공지능 개발 툴을 쓴다"는 목적에 가장 정확히 부합하는 수단이다.
- **정체성과도 맞는다:** 이 CLI 들은 단순 챗봇이 아니라 **코딩 에이전트**다. 바둑판 UI 와 결합하면 **여러 코딩 에이전트를 한 화면에서 동시에 돌리고 감독하는 오케스트레이션 도구**가 된다. 이것이 FRAI 의 진짜 차별점이며, 포화된 BYOK 채팅 클라이언트 시장에서 벗어나는 지점이다.
- **MCP 부담이 줄어든다:** `claude` CLI 가 자체적으로 MCP 를 지원하므로, FRAI 가 MCP 클라이언트를 직접 구현할 필요성이 낮아진다. v0.2 의 우선순위를 재검토한다.

**구현 방침**

- **v0.1 은 대화형 TUI 가 아니라 one-shot + 구조화 출력으로 간다.** 예: `claude -p "<프롬프트>" --output-format stream-json`. 전체 TUI 를 PTY 로 띄우고 ANSI 를 파싱하는 방식은 비용이 훨씬 크므로 나중에 검토한다.
- **CLI 마다 어댑터를 따로 만든다.** 인자·출력 포맷·세션 관리 방식이 제각각이므로 공통 인터페이스로 감싸되 내부는 개별 구현한다. 각 CLI 의 실제 옵션은 **구현 시점에 `--help` 로 직접 확인**한다. 문서에 옵션을 단정적으로 박아두지 않는다.
- **대화 연속성**은 각 CLI 가 제공하는 세션 재개 기능(예: `--resume <session-id>`)을 우선 사용하고, 없으면 히스토리를 매번 전달한다.
- **설치 탐지**: `PATH` 에서 실행 파일을 찾아 사용 가능한 CLI 만 UI 에 노출한다. 버전도 함께 확인한다.

**⚠️ macOS GUI 앱의 PATH 함정 (최우선 처리 — 실측으로 확인됨)**

`.app` 번들로 실행된 GUI 앱은 **사용자의 셸 PATH 를 상속받지 않는다.** 터미널에서는 `claude` 가 잘 실행되는데 FRAI 안에서는 "command not found" 가 나는 현상이 여기서 생긴다.

**이 개발 머신에서 실측한 결과, 대상 CLI 5개가 전부 GUI 기본 PATH 밖에 있다:**

| CLI | 실제 경로 | GUI 기본 PATH 포함? |
|---|---|---|
| `claude` | `~/.local/bin/claude` | ❌ |
| `codex` | `~/.local/bin/codex` | ❌ |
| `opencode` | `~/.nvm/versions/node/v24.14.1/bin/opencode` | ❌ (nvm — **노드 버전 바뀌면 경로도 바뀜**) |
| `grok` | `~/.grok/bin/grok` | ❌ |
| `kimi` | `~/.kimi-code/bin/kimi` | ❌ |

즉 **아무 대책 없이 구현하면 CLI 연동 기능 전체가 배포본에서 100% 실패한다.** 선택 사항이 아니라 필수 선결 과제다.

대응:

1. **로그인 셸에서 PATH 를 얻어온다.** `$SHELL -l -c 'echo $PATH'` 를 실행해 사용자의 실제 PATH 를 확보한 뒤, 자식 프로세스에 그 환경을 물려준다. **경로를 하드코딩하지 않는다** — nvm 경로는 노드 버전에 따라 바뀌므로 하드코딩이 반드시 깨진다.
2. 그래도 못 찾으면 **설정에서 사용자가 실행 파일 경로를 직접 지정**할 수 있게 한다.
3. 탐지 결과와 실패 사유를 UI 에 명확히 보여준다("설치되지 않음" 과 "찾지 못함" 은 다른 문제다).

**⚠️ `tauri dev` 로는 이 문제가 재현되지 않는다.** 개발 서버는 터미널의 PATH 를 그대로 물려받기 때문에 개발 중에는 멀쩡히 동작하다가 배포본에서만 터진다. **반드시 `.app` 빌드본으로 검증한다.**

**⚠️ 보안**

- 서브프로세스 실행은 강력한 권한이다. **허용된 CLI 목록에 있는 실행 파일만** 구동한다. 프론트에서 임의 명령 문자열을 받아 실행하는 구조를 만들지 않는다.
- 프롬프트는 인자로 붙일 때 셸을 거치지 않도록 한다(셸 경유 시 인젝션 위험). 실행 인자 배열로 직접 전달한다.

### 경로 2. 로컬 LLM (Ollama)

- 완전 무료 경로이므로 후순위 옵션이 아니라 초기부터 지원 대상이다.
- Ollama 는 로컬 HTTP 서버(`localhost:11434`)를 제공하므로 API 경로와 동일하게 다루면 된다.

### 경로 3. API 키 (BYOK)

- Anthropic · OpenAI · Google Gemini · OpenRouter.
- **무료 티어 및 저가 경로를 조사해 앱 안에서 안내한다.** OpenRouter 의 무료 모델, Google AI Studio, Groq 등이 후보다. 단, 각 서비스의 무료 정책은 수시로 바뀌므로 **문서에 단정적으로 박지 말고 구현 시점에 반드시 재확인**한다.
- **API 키 발급 안내를 온보딩에 포함한다.** 한국어 사용자 기준으로 각 프로바이더의 키 발급 절차를 앱 안에서 단계별로 안내한다. BYOK 의 가장 큰 진입 장벽이 이 지점이다.

### 공통

- **세 경로가 프론트에서는 동일하게 보여야 한다.** 세션 하나가 API 를 쓰든 Ollama 를 쓰든 CLI 를 쓰든, 프론트는 같은 이벤트 스트림을 받는다. 이 추상화가 아키텍처의 핵심이다.
- **비용 가시화가 핵심 기능이다.** 요청별 토큰 사용량과 예상 비용을 표시하고 세션·기간 단위로 누적한다. "최대한 저렴하게"라는 목적은 사용자가 비용을 볼 수 있어야 달성된다. **CLI·Ollama 경로는 "추가 비용 없음"으로 명확히 표시**해 대비를 보여준다. 그리드 UI 와 결합하면 같은 질문에 대한 **모델별 비용·품질 비교**가 되며, 이것이 FRAI 만의 강점이 된다.


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

### 5. 대화 **내용**은 로컬을 벗어나지 않는다 (경계를 정확히 지킬 것)

서버 동기화를 도입하면서 경계가 생겼다. **이 경계를 넘지 않는 것이 원칙의 핵심이다.**

| 데이터 | 위치 | 비고 |
|---|---|---|
| 대화 **내용**(메시지 본문) | **로컬 SQLite 만** | 서버로 보내지 않는다 |
| 세션 **목록**(제목·칸반 위치·프로바이더·순서) | getpes.com DB (로그인 시) | 기기 간 동기화용 |
| 기본 AI 사용 시 주고받는 프롬프트/응답 | 서버를 **경유**(저장은 하지 않음) | UI 에 "서버 경유" 배지로 고지 |

- **세션 제목은 첫 질문에서 자동 생성되므로 사용자 발화의 일부다.** 이것이 서버로 가는 유일한 대화 유래 데이터이며, 사용자가 제목을 직접 바꿀 수 있어야 한다. 동기화 켤 때 이 사실을 고지한다.
- 텔레메트리·크래시 리포트·분석 도구에 대화 내용이 포함되지 않도록 한다.
- 이 경계를 사용자에게 문서로 명시한다. 제품의 셀링 포인트이기도 하다.


## 계정 · 데이터 동기화 (getpes.com DB 공유)

FRAI 는 **getpes.com 과 같은 PostgreSQL DB** 를 쓴다. 별도 DB 를 두지 않는다.

### 로그인 — PES 와 호환되어야 한다

PES 의 인증 구조 (`~/apps/pes/web/src/routes/api/auth/session/+server.ts`, `hooks.server.ts`):

```
클라이언트 ──Firebase idToken──> POST /api/auth/session
                                   ├ adminAuth().verifyIdToken()
                                   ├ upsertUserProfile()  → web.user_profiles
                                   └ createSessionCookie() → httpOnly 세션 쿠키
이후 요청 ──세션 쿠키──> hooks.server.ts: verifySessionCookie() → locals.uid
```

**FRAI 도 같은 `uid` 를 얻어야 세션 목록을 공유할 수 있다.** 즉 Firebase idToken 을 얻어 `/api/auth/session` 을 그대로 호출하는 것이 정답이다. 문제는 **idToken 을 어떻게 얻느냐**이며, 방식이 셋이다.

**✅ 확정: A — 시스템 브라우저 + 루프백 콜백 + PKCE.** (`src/main/auth/` 구현 완료)

CSP 를 열지 않아도 되고, PES 가 지원하는 로그인 제공자를 그대로 쓸 수 있다.

**⚠️ 콜백은 커스텀 스킴(`frai://`)이 아니라 루프백(`127.0.0.1`)으로 받는다.** 커스텀 스킴은 다음 이유로 채택하지 않았다.

| | 커스텀 스킴 `frai://` | **루프백 `127.0.0.1`** |
|---|---|---|
| `tauri dev` 에서 동작 | ❌ `.app` 번들이 LaunchServices 에 등록돼야 함 | ✅ |
| 브라우저 차단 | 사용자 제스처 없는 스킴 전환을 막는 경우가 있다 | ✅ 평범한 http 리다이렉트 |
| 하이재킹 | 다른 앱이 같은 스킴을 등록할 수 있다 | 포트를 앱이 점유 |
| Info.plist | 수정 필요 | 불필요 |

커스텀 스킴을 쓰면 **PATH 함정과 똑같이 "개발 중엔 되고 배포본에서만 깨지는" 구조**가 하나 더 생긴다. 루프백은 RFC 8252(OAuth 2.0 for Native Apps)가 네이티브 앱에 권장하는 방식이다.

**⚠️ 루프백이라도 PKCE 는 반드시 쓴다.** 같은 기기의 다른 프로세스가 code 를 가로챌 여지가 남아 있고, `code_verifier` 없이는 그 code 를 쓸 수 없어야 한다.

### 인증 규약 (FRAI ↔ getpes.com) — ✅ 양쪽 구현 완료

| 쪽 | 파일 | 상태 |
|---|---|---|
| 앱 | `src/main/auth/` | ✅ 브라우저 + 루프백 + PKCE, 토큰은 `safeStorage`, 로그아웃 시 서버 revoke 호출 |
| 서버 | `~/apps/pes/web/src/routes/frai/auth/+server.ts` | ✅ code 발급 · 루프백 리다이렉트 |
| 서버 | `~/apps/pes/web/src/routes/frai/api/auth/exchange/+server.ts` | ✅ PKCE 검증 · 토큰 발급 |
| 서버 | `~/apps/pes/web/src/routes/frai/api/auth/revoke/+server.ts` | ✅ 토큰 폐기(로그아웃) |
| 서버 | `~/apps/pes/web/src/lib/server/frai/{pkce,auth}.ts` | ✅ 순수 검증 / DB 접근 분리 |
| DB | `web.frai_auth_codes` · `web.frai_tokens` | ✅ 마이그레이션 `drizzle/0019_*.sql` |

**서버 쪽 설계 요점**
- **토큰은 평문이 아니라 SHA-256 해시로 저장한다.** DB 가 유출되어도 토큰을 복원할 수 없다.
- code 1회 사용은 **조건부 UPDATE**(`usedAt IS NULL`)로 처리한다. 동시에 두 번 교환되면 한쪽만 성공한다.
- 교환 실패 사유(`없음`/`이미 씀`/`PKCE 불일치`)를 **응답에 노출하지 않는다.** 서버 로그에만 남긴다.
- ⚠️ `/frai/auth` 는 브라우저 요청 시 PES 의 언어 감지에 걸려 `/ko/frai/auth` 로 한 번 더 302 된다.
  **동작에는 문제가 없다**(reroute 훅이 라우트를 매칭하고 쿼리도 보존된다). 이 때문에 PES 의
  `hooks.server.ts` 를 수정하지 않았다 — 핵심 파일을 건드리는 위험이 이득보다 크다.

아래는 그 규약이다.

```
1) 앱이 127.0.0.1 임의 포트에 1회용 서버를 열고 기본 브라우저로 이동
   GET /frai/auth
       ?redirect_uri=http://127.0.0.1:<port>/callback
       &state=<난수>
       &code_challenge=<BASE64URL(SHA256(verifier))>
       &code_challenge_method=S256

   서버: 로그인 안 됐으면 기존 PES 로그인으로 유도 → 완료 후 되돌아온다.
        로그인 상태면 일회용 code 발급(짧은 만료 · 1회 사용 · challenge 와 함께 저장)
        → 302 redirect_uri?code=<code>&state=<그대로>

2) 앱이 code 를 받아 교환 (여기서 verifier 를 처음 보낸다)
   POST /frai/api/auth/exchange
   { "code": "...", "codeVerifier": "...", "redirectUri": "http://127.0.0.1:<port>/callback" }

   서버 검증: code 존재·미사용·미만료 / BASE64URL(SHA256(codeVerifier)) == 저장된 challenge
              / redirectUri 일치
   → 200 { "token": "<FRAI 세션 토큰>", "uid": "...", "displayName": "..." }

3) 이후 모든 API 호출
   Authorization: Bearer <token>
```

- **`redirect_uri` 는 `http://127.0.0.1:<임의 포트>` 만 허용한다.** 포트는 매번 달라지므로 호스트만 고정 검증하고 포트는 열어 둔다. 그 외 호스트는 거부한다(오픈 리다이렉트 방지).
- `state` 는 앱이 검증한다. 서버는 받은 값을 그대로 돌려주기만 하면 된다.
- 발급 토큰은 PES 세션 쿠키와 별개인 **FRAI 전용 토큰**을 권장한다. 쿠키 값을 그대로 주면 만료·폐기 관리가 얽힌다.
- 토큰 폐기(로그아웃) 엔드포인트도 함께 만든다.

⚠️ **세션 토큰은 Rust 가 OS 키체인(`com.getpes.frai` / `pes-session`)에 보관하고 웹뷰에 노출하지 않는다.** 토큰을 반환하는 Tauri 명령을 만들지 않는다 — 프론트는 "로그인했는가 · 누구인가" 만 안다. API 키와 같은 원칙이다.

### 스키마 초안 (PES `web` 스키마에 추가)

Drizzle 로 정의하고 마이그레이션을 만든다. `~/apps/pes/web/src/lib/server/db/schema.ts` 의 `faiDocuments` 패턴을 따른다.

```
web.frai_sessions
  id            bigserial PK
  uid           text NOT NULL → user_profiles.uid
  title         varchar(200)
  column_id     varchar(64)      -- 칸반 칸
  provider_id   varchar(64)
  sort          integer
  created_at / updated_at

web.frai_columns
  id            bigserial PK
  uid           text NOT NULL → user_profiles.uid
  key           varchar(64)      -- 'backlog' 등 클라이언트 칸 id
  title         varchar(100)
  sort          integer
```

- **메시지 테이블은 만들지 않는다.** 대화 내용은 로컬 SQLite 에만 둔다 (보안 원칙 5 참조).
- 칸반 칸 구성도 사용자별로 저장한다. 기기를 옮겨도 보드가 그대로 재현되어야 한다.

### 동기화 규칙

- **익명 상태에서는 서버를 건드리지 않는다.** 전부 로컬.
- **로그인하면 그 시점의 로컬 세션 목록을 서버로 올리고(merge), 이후 양방향 동기화한다.** 로그인했다고 기존 작업이 사라지면 안 된다.
- 충돌은 `updated_at` 이 최신인 쪽을 채택한다. 세션 목록은 메타데이터라 이 단순 규칙으로 충분하다.
- **오프라인에서도 앱은 완전히 동작해야 한다.** 동기화는 부가 기능이지 전제 조건이 아니다. 서버가 죽어도 로컬 작업은 계속된다.

## 아키텍처 원칙

- **프로바이더 추상화는 서로 다른 3가지 전송 방식(transport)을 감싼다.** 이것이 이 앱 아키텍처의 핵심이다.
  1. **HTTP/SSE** — Anthropic · OpenAI · Gemini · OpenRouter · Ollama
  2. **서브프로세스** — `claude` · `codex` · `opencode` · `grok` · `kimi` 등 설치된 CLI
  3. (향후) 그 외
  전송 방식이 무엇이든 **프론트가 받는 이벤트 스트림의 형태는 동일해야 한다.** 이 추상화가 무너지면 그리드 UI 가 프로바이더마다 분기 처리로 오염된다.
- **스트리밍은 Rust 에서 처리해 프론트로 이벤트를 emit 한다.** HTTP 경로는 SSE 를 파싱하고, CLI 경로는 자식 프로세스의 stdout 을 읽어 같은 형태의 이벤트로 변환한다. 프론트는 `listen()` 으로 청크를 받을 뿐 출처를 알 필요가 없다. 이 구조여야 CORS 문제가 없고 키가 웹뷰에 노출되지 않는다.
- **자식 프로세스의 생명주기를 Rust 가 책임진다.** 세션 종료·앱 종료·강제 중단 시 자식 프로세스가 좀비로 남지 않도록 확실히 정리한다. 그리드로 여러 개를 동시에 띄우므로 누수가 빠르게 쌓인다.
- **모든 스트리밍 이벤트는 세션 ID 로 구분된다.** (그리드 멀티 세션 전제)
- 세션별 중단(cancel), 재시도, 에러 상태를 독립적으로 관리한다. 한 세션의 실패가 다른 세션에 영향을 주지 않아야 한다.


## 디렉토리 구조 (예정)

```
src/
  main/                # Electron main — 여기서만 Node/OS 를 만진다
    index.ts           # ★ 앱 조립 · 창 · CSP · 메뉴 (electron import)
    ipc.ts             # ★ renderer 가 부를 수 있는 것 전부 (electron import)
    events.ts          # ★ 통일 이벤트(SessionEvent) + EventSink — electron 을 모른다
    session.ts         # 세션별 태스크·취소 (AbortSignal). 오류 emit 은 여기 한 곳뿐
    provider/
      index.ts         # Provider 인터페이스 · resolve · listProviders
      detect.ts        # ★ 로그인 셸 PATH 확보 + CLI 탐지 (Windows PATHEXT 대응)
      cli.ts           # 서브프로세스 어댑터 + 프로세스 그룹 종료
      relay.ts         # getpes.com 릴레이 어댑터 (기본 AI)
    auth/
      pkce.ts          # 순수 PKCE (창·네트워크 없이 테스트)
      index.ts         # 루프백 + 브라우저 로그인 흐름 (저장소를 주입받는다)
      store.ts         # safeStorage 어댑터 (electron import)
  preload/
    index.ts           # ★ contextBridge 화이트리스트 — 이 앱의 신뢰 경계
  renderer/            # Svelte 5 + TypeScript (Node API 접근 불가)
    index.html · main.ts · App.svelte · app.css · global.d.ts
    lib/
      sessions.svelte.ts   # 세션·칸반 상태 (runes) + 이벤트 라우팅
      SessionCard.svelte · KanbanBoard.svelte · ui/
  shared/
    types.ts           # main·renderer 공용 타입 + IPC 채널 목록(화이트리스트의 출처)

⚠️ **`main/` 로직 모듈은 `electron` 을 import 하지 않는다.** 예외는 `main/index.ts`·
`main/ipc.ts`·`main/auth/store.ts` 셋뿐이며, `npm run check:security` 가 이 규칙을 강제한다.
이 경계가 "창을 띄우지 않는 검증" 을 가능하게 한다.

src-tauri/                 # 옛 Tauri 구현 — 참고용으로 남겨 둔다(빌드에서 제외)
```


## 배포

### 확정 사항

- **Mac App Store 를 사용하지 않는다. DMG 를 홈페이지에서 직접 배포한다.** (확정)
  - 근거: App Store 는 샌드박스가 강제되어 **로컬 프로세스 실행과 임의 경로 파일 접근이 막힌다.** 이는 "무료" 목적의 핵심인 **Ollama 연동**과 v0.2 의 **MCP 서버 실행** 양쪽을 모두 불가능하게 만든다.
- **배포 주소: https://getpes.com/frai/**
- **소스 저장소: https://github.com/thruthesky/frai** (PES 와 별도 저장소)
- **macOS 전용.** Apple 개발자 등록 완료 상태. Universal binary(`aarch64-apple-darwin` + `x86_64-apple-darwin`)로 빌드한다.
- **모든 비밀값은 `keys/` 아래에 둔다.** `keys/` 는 `.gitignore` 로 제외되며 **절대 커밋하지 않는다.** 문서·코드·커밋 메시지에 Team ID 를 포함한 비밀값을 직접 적지 않는다.
  ```
  keys/
    apple/apple-team-id.txt        # Apple Team ID
    apple/AuthKey_*.p8             # App Store Connect API 키 (공증 대체 수단)
    apple/ios-app.txt
    frai-updater.key(.pub)         # Tauri 업데이터 minisign 키쌍
  .env.local                       # 빌드 환경변수 (.env.example 복사본) — 역시 커밋 금지
  ```
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
- **버킷은 기존 `pes-models` 를 그대로 쓰고, 모든 FRAI 파일은 `frai/` 프리픽스 아래에 둔다.** (확정) 새 버킷을 만들지 않는다.
  ```
  pes-models/
    frai/
      releases/<version>/Frai_<version>_universal.dmg
      releases/<version>/Frai.app.tar.gz
      releases/<version>/Frai.app.tar.gz.sig
      latest.json                                    # 업데이터 매니페스트 (고정 경로)
  ```
- R2 버킷의 공개 접근 방식(공개 `r2.dev` URL vs 커스텀 도메인)은 **구현 시 확인 후 확정한다.** Cloudflare 에 도메인이 있으므로 `dl.getpes.com` 같은 서브도메인 연결이 깔끔하다.

### 랜딩 페이지 (`https://getpes.com/frai/`)

- **SvelteKit 라우트로 구현한다.** (확정) `~/apps/pes/web/src/routes/` 아래에 만들며, 정적 HTML 로 만들지 않는다. SEO·i18n 혜택을 취한다.
- Caddy 기본 라우팅에 의해 `/frai/*` 는 `pes-web:3000`(SvelteKit)이 처리한다. 별도 프록시 규칙 추가는 불필요하다.
- ⚠️ **PES 저장소에서 작업할 때는 PES 의 규칙이 적용된다.** 특히 **"화면에 보이는 모든 문장은 7개 국어(en·ko·ja·zh·hi·bn·ur) 번역" 절대 규칙**이 랜딩 페이지에도 적용된다. 작업 전 `~/apps/pes/CLAUDE.md` 와 `~/apps/pes/docs/i18n.md` 를 반드시 읽는다.
  - 메시지는 `web/messages/` 의 7개 파일에 **동시에** 추가한다. 한 언어라도 빠지면 미완성이다.
  - 내부 링크는 `localizeHref()` 로 감싼다.
  - 우르두(ur)는 RTL 이므로 CSS 는 `margin-left` 대신 `margin-inline-start` 같은 **논리 속성**을 쓴다.
  - 작업 후 `cd web && pnpm test` 로 번역 누락 검사를 통과시킨다.
- **랜딩 페이지에 버전·다운로드 URL 을 하드코딩하지 않는다.** R2 의 릴리스 JSON 을 fetch 해서 표시한다. 그래야 **FRAI 새 버전 배포에 PES 재배포가 필요 없다.** (브라우저에서 fetch 하므로 R2 버킷에 CORS 설정이 필요하다.)

### 자동 업데이트 — 주의할 점

- `tauri-plugin-updater` + 정적 JSON 매니페스트(`latest.json`)를 R2 에 둔다.
- ⚠️ **업데이터가 받는 아티팩트는 DMG 가 아니다.** macOS 업데이터는 **`Frai.app.tar.gz` + `Frai.app.tar.gz.sig`** 를 사용한다. DMG 는 사용자가 처음 설치할 때만 쓴다. 릴리스마다 **두 종류를 모두** 올려야 한다.
- ⚠️ **Tauri 업데이터 서명과 Apple 코드서명은 완전히 별개다.**
  - Apple 코드서명·공증: 아래 자격증명 → `tauri build` 가 서명·공증·staple 까지 처리.
  - Tauri 업데이터 서명: `tauri signer generate` 로 minisign 키쌍 생성. 공개키는 `tauri.conf.json` 에 넣고, **비밀키는 절대 저장소에 커밋하지 않는다.**

### 공증 자격증명 — **App Store Connect API 키를 쓴다** (실측으로 확정)

두 방식이 있는데, **Apple ID + 앱 전용 암호 방식은 이 프로젝트에서 401 로 실패했다.**

```
Error: HTTP status code: 401. Invalid credentials.
Username or password is incorrect. Use the app-specific password generated at appleid.apple.com.
```

값의 **형식은 전부 정상이었다**(이메일 형태, 하이픈 3개 19자 앱 전용 암호, 10자 팀 ID). 형식이 맞아도
암호를 발급한 계정과 `APPLE_ID` 가 다르거나 암호가 폐기되면 이 오류가 난다. 형식만 보고 원인을 찾지 말 것.

**→ `keys/apple/AuthKey_*.p8` (App Store Connect API 키)로 전환해 해결했다.**

| 환경변수 | 값 |
|---|---|
| `APPLE_API_KEY` | Key ID — `AuthKey_<이것>.p8` 파일명에서 얻는다 |
| `APPLE_API_ISSUER` | Issuer ID (UUID) — `keys/apple/ios-app.txt` |
| `APPLE_API_KEY_PATH` | `.p8` 파일의 **절대경로** |

**빌드 전에 자격증명만 따로 검증할 수 있다.** 30분짜리 빌드를 돌리고 마지막에 401 을 보는 것보다 낫다:

```bash
xcrun notarytool history --key <p8 절대경로> --key-id <Key ID> --issuer <Issuer ID>
# → "Successfully received submission history." 가 나오면 유효하다
```

⚠️ 두 방식의 환경변수가 **동시에 설정되어 있으면 안 된다.** `APPLE_ID` 가 남아 있으면 그쪽이 먼저 시도되어
401 로 실패한다. API 키 방식을 쓸 때는 `unset APPLE_ID APPLE_PASSWORD` 한다.

### 서명 자산 현황 (설정 완료)

| 항목 | 상태 |
|---|---|
| Developer ID Application 인증서 | ✅ 키체인에 존재 (`security find-identity -v -p codesigning` 로 확인) |
| Apple Team ID | ✅ `keys/apple/apple-team-id.txt` |
| 공증 자격증명 (`APPLE_ID` · 앱 전용 암호) | ✅ `.env.local` |
| Tauri 업데이터 minisign 키쌍 | ✅ `keys/frai-updater.key` (비밀키) · `keys/frai-updater.key.pub` (공개키) |
| 공개키 등록 | ✅ `tauri.conf.json` 의 `plugins.updater.pubkey` |
| 업데이터 아티팩트 생성 | ✅ `bundle.createUpdaterArtifacts: true` — 이 설정이 없으면 `.app.tar.gz` 가 생성되지 않는다 |
| 빌드 환경변수 | `.env.example` 참조 → `.env.local` 로 복사해 사용 |

**⚠️ minisign 비밀키는 비밀번호 없이 생성되어 있다.** `keys/` 가 `.gitignore` 로 보호되지만, **이 키를 분실하면 기존 사용자에게 업데이트를 배포할 수 없다.** 반드시 안전한 곳에 별도 백업한다. (재발급하면 이미 설치된 앱이 새 서명을 신뢰하지 않는다.)

### 릴리스 절차

```bash
# 1. 환경변수 로드 (.env.local 은 .env.example 을 복사해 채운다)
set -a && source .env.local && set +a

# 2. 서명·공증 포함 Universal binary 빌드
#    → DMG + Frai.app.tar.gz + Frai.app.tar.gz.sig 생성
npm run build:app

# 3. 산출물 검증 (아티팩트 3종 · Universal · 서명 · 공증)
bash scripts/verify-release.sh

# 4. 업데이터 매니페스트 생성
bash scripts/make-latest-json.sh <R2_PUBLIC_BASE_URL>

# 5. R2 업로드 (버킷 pes-models, 프리픽스 frai/)
#    ~/apps/pes/scripts/r2-put.py 참고
```

- 랜딩 페이지는 R2 의 JSON 을 읽으므로 **PES 재배포가 필요 없다.**
- 업로드 후 실제 다운로드·설치·자동업데이트를 **`.app` 빌드본으로** 검증한다.

**⚠️ 실제로 겪은 함정 — `.sig` 가 조용히 생성되지 않는다.**

`TAURI_SIGNING_PRIVATE_KEY_PASSWORD` 를 설정하지 않으면, 키에 비밀번호가 없더라도 `tauri build` 가
비밀번호 프롬프트를 띄우려다 비대화형 환경에서 실패한다. 그런데 **빌드 자체는 exit 0 으로 끝나서**
`.sig` 가 없는 줄 모르고 배포하게 된다. `.sig` 가 없으면 자동 업데이트가 동작하지 않는다.

- 대응 1: `.env.local` 에 `TAURI_SIGNING_PRIVATE_KEY_PASSWORD=""` 를 **반드시 빈 값으로라도 둔다.**
- 대응 2: `scripts/verify-release.sh` 가 `.sig` 존재를 검사한다. **배포 전에 반드시 실행한다.**
- 이미 빌드한 산출물에 서명만 다시 붙이려면(전체 재빌드 불필요):
  ```bash
  env -u TAURI_SIGNING_PRIVATE_KEY npx tauri signer sign \
    -f "$PWD/keys/frai-updater.key" -p "" <경로>/Frai.app.tar.gz
  ```


## 미결정 사항

- 그리드 세션의 대화 컨텍스트 공유 방식 — 세션마다 완전히 독립인지, 컨텍스트를 복제·전달할 수 있는지.
- R2 공개 접근 방식 — 공개 `r2.dev` URL 을 쓸지, `dl.getpes.com` 커스텀 도메인을 연결할지.


## 로드맵

- **v0.1 (MVP)**
  1. ✅ Tauri v2 + Svelte 5 프로젝트 생성, CSP 설정, 서명/공증/자동업데이트 자산 준비
  2. ✅ **통일 스트리밍 이벤트 추상화** + 두 전송 방식을 나란히 구현
     - ✅ `claude` CLI 어댑터 (서브프로세스) — 출력 형식 실측 후 구현
     - ✅ 기본 AI 릴레이 어댑터 (HTTP/SSE) — 클라이언트 측
     - 두 경로를 같이 붙여야 추상화가 검증된다. 한쪽만 만들고 나중에 끼워 넣으면 반드시 새는 추상화가 된다.
  3. ✅ **그리드 멀티 세션 골격** — 세션별 프로바이더 선택, 브로드캐스트 입력, 서버경유/로컬 배지
  3-1. ✅ **세션 목록 (칸반 보드)** — 네이티브 메뉴 `보기`(⌘1/⌘2), 칸 추가·이름변경·삭제, 드래그로 세션 이동
  4. ✅ **getpes.com 릴레이 서버 구현** (PES 저장소) — 위 "릴레이 API 규약" 대로. 익명 5회 / 로그인 20회 + 전역 예산 상한.
       두뇌는 OpenAI Chat Completions 규격으로 추상화되어 환경변수만으로 교체된다(기본 AKRouter).
       ⚠️ **프로덕션에 `AKROUTER_API_KEY` 를 넣어야 실제로 동작한다.**
  4-1. ✅ **PES 호환 로그인** — 앱(`auth.rs`)과 서버(PES `/frai/auth` · `/frai/api/auth/{exchange,revoke}`) 양쪽 완료.
       마이그레이션 `0019` 는 **PES 배포 시 컨테이너 기동에서 자동 적용**된다.
  4-2. ⬜ **세션 목록 동기화** — `frai_sessions` · `frai_columns` 테이블 + API. 로그인 시 로컬 목록 merge
  5. ⬜ 키체인 + 개인 API 키 경로(Anthropic 등), Ollama
  6. ⬜ SQLite 대화 저장·검색, 마크다운/코드 렌더링(sanitize 포함), 가상 스크롤
  7. ⬜ **`.app` 빌드본으로 CLI 실행 검증** (PATH 함정은 `tauri dev` 에서 재현되지 않는다)

  **현재 남은 기술 부채**
  - `claude` 의 `stream-json` 은 **델타가 아니라 메시지 단위**다. 답변이 완성된 뒤 한 덩어리로 온다. 토큰 단위 스트리밍이 필요하면 부분 메시지 옵션을 조사해 `claude_cli.rs` 를 확장한다.
  - `codex`·`opencode`·`grok`·`kimi` 는 `verified: false` 다. 정식 지원 시 각각 `--help` 로 인자·출력 형식을 **직접 확인한 뒤** `CLI_SPECS` 를 고친다. 추측으로 채우지 않는다.
  - 대화 히스토리를 CLI 에 넘기는 방식이 아직 마지막 발화뿐이다. `--resume` 세션 연결을 붙여야 맥락이 이어진다.
- **v0.2** — CLI 어댑터 확대(`codex`·`opencode`·`grok`·`kimi`), API 프로바이더 확대.
- **MCP 는 우선순위를 재검토한다.** `claude` CLI 가 자체 MCP 를 지원하므로, FRAI 가 직접 MCP 클라이언트를 구현하는 가치가 예전보다 낮아졌다. 직접 구현 시 `rmcp` 크레이트를 쓰되 프로토콜보다 **권한 동의 UI·툴 호출 루프·서버 크래시 복구·stderr 로그 뷰**가 실제 비용임을 기억한다.
