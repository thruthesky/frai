# FRAI 테스트 지침

> 이 문서는 [CLAUDE.md](CLAUDE.md) 의 "테스트 원칙" 을 실제 코드 수준에서 설명하는 레퍼런스다.
> 새 기능을 붙이기 전에 반드시 읽는다.

---

## 0. 절대 규칙 두 가지

### (1) 인공지능이 자율적으로 모든 테스트를 수행한다

사람 개발자에게 테스트를 요청하는 것은 **금지**된다.
"직접 만져보세요" · "확인해 주세요" · "잘 되는지 봐 주세요" 는 작업을 끝내지 않은 것이다.

### (2) 화면에 띄우지 않고 테스트한다

**사람 개발자는 같은 컴퓨터에서 다른 일을 하고 있다.**

인공지능이 자율적으로 앱을 반복해서 화면에 띄우면, 사람이 타이핑하던 창에서 포커스가 사라지고
작업이 **매우 크게 방해받는다.** 실제로 이 프로젝트에서 그 문제가 발생했고, 그래서 이 규칙이 생겼다.

- ❌ **`osascript` 로 앱을 `frontmost` 로 만드는 것 — 절대 금지**
- ❌ **전체 화면 스크린샷 — 금지** (사람의 작업 내용이 그대로 찍힌다)
- ❌ **테스트를 위해 앱 창을 띄우는 것 — 금지**
- ✅ 모든 검증은 **창을 띄우지 않는 수단**으로 한다

**"화면에 띄워야만 확인할 수 있다" 는 판단이 들면, 그것은 설계를 고쳐야 한다는 신호다.**
아래 1장이 그 실제 사례다.

---

## 1. 창 없이도 실제 동작을 검증할 수 있게 만든 방법

`EventSink` 가 `AppHandle` 을 직접 들고 있어서 Tauri 런타임 없이는 테스트가 불가능했다.
**클로저 기반으로 바꿨다.**

```rust
pub struct EventSink {
    emit: Arc<dyn Fn(SessionEvent) + Send + Sync>,   // AppHandle 대신
    session_id: String,
}
```

이 한 번의 변경으로 어댑터를 **진짜 끝까지 돌리면서도**(자식 프로세스 spawn, HTTP 스트리밍 포함)
앱 창이 필요 없어졌다. 설계 자체도 더 나아졌다 — **어댑터는 이벤트가 어디로 가는지 알 필요가 없다.**

```rust
// 운영: Tauri 로 emit
EventSink::new(app_handle, session_id)

// 테스트: 벡터에 수집 (창 없음)
EventSink::from_fn(session_id, move |ev| events.lock().unwrap().push(ev))
```

### 그래서 지금 자동으로 확인되는 것들

- **`claude` CLI 를 실제로 실행해** "2+3" 질문 → 답에 `5` 가 오는지,
  `started` 이벤트가 먼저 오는지, `usage` 에 비용·토큰이 실리는지
- **모든 이벤트에 세션 ID 가 정확히 실리는지** (그리드의 핵심 전제)
- **릴레이 모의 SSE 서버를 띄워** chunk 이어붙임 → done → 남은 무료 횟수까지 전 구간
- **429 응답 시** "개인 API 키 또는 CLI" 안내가 나오는지
- **없는 CLI 를 지정하면** 조용히 성공하지 않고 명확히 실패하는지
- **칸을 지우면** 세션이 Backlog 로 돌아오고 하나도 사라지지 않는지
- **한 세션의 오류가 다른 세션을 건드리지 않는지**

위 전부가 **앱 창을 하나도 띄우지 않고** 확인된다.

---

## 2. 실행 방법

```bash
npm run test:all      # 타입 검사 → 프론트 → Rust 전부
```

개별 실행:

| 대상 | 명령 | 개수 | 창 뜸? |
|---|---|---|---|
| 타입 정합성 | `npm run check` | 138 파일 | ❌ |
| 프론트 상태·칸반·이벤트 라우팅 | `npm run test` (vitest, node 환경) | 26 | ❌ |
| Rust 유닛 + 통합 | `cd src-tauri && cargo test` | 38 | ❌ |

**합계 64개 테스트 — 전부 창을 띄우지 않는다.**

---

## 3. 테스트가 어디에 있는가

| 파일 | 무엇을 검증하나 |
|---|---|
| `src-tauri/src/provider/claude_cli.rs` (`mod tests`) | `claude` 의 stream-json JSONL 파싱. 툴 블록 섞임, JSON 아닌 줄, `is_error` |
| `src-tauri/src/provider/relay.rs` (`mod tests`) | SSE 줄 파싱. `data:` 공백 유무, `[DONE]`, usage 누락, 빈 청크 |
| `src-tauri/src/provider/detect.rs` (`mod tests`) | CLI 스펙 무결성(id 중복·verified 범위), 로그인 셸 PATH 확보, 실행파일 탐지 |
| `src-tauri/src/auth.rs` (`mod tests`) | PKCE(RFC 7636 공식 예시와 일치), percent 인코딩 왕복, 콜백 쿼리 파싱 |
| `src-tauri/src/integration_tests.rs` | **어댑터 전 구간** — 실제 프로세스 실행, 모의 SSE 서버, 프로바이더 목록 |
| `src/lib/sessions.test.ts` | 세션 상태, 이벤트 라우팅, 칸반 이동/삭제, 브로드캐스트, 계정 |

---

## 4. 새 기능을 붙일 때 지켜야 할 것

1. **로직을 UI 밖에 둔다.** 웹뷰 안에서만 확인 가능한 코드를 만들지 않는다.
   상태·분기·파싱은 `sessions.svelte.ts` 나 Rust 쪽에 두고 컴포넌트는 그리기만 한다.
2. **부수효과와 순수 계산을 분리한다.** 파싱 함수는 값을 반환하고, 이벤트 전송은 호출부가 한다.
   (`parse_claude_line` · `parse_sse_line` 이 그 형태다.)
3. **전역 상태에 의존하는 테스트를 만들지 않는다.**
   실제로 `std::env::set_var("FRAI_RELAY_URL")` 로 테스트하다가 **병렬 실행 중 서로의 값을 덮어써서
   429 테스트가 다른 테스트의 정상 응답을 받아 통과할 뻔했다.** 지금은 `RelayProvider::with_url()` 로 주입한다.
4. **새 기능도 창 없이 검증되는지 확인한다.** 이 성질을 깨는 설계는 다시 생각한다.

---

## 5. 자동 검증이 어려운 항목 (현재 남은 것)

원리적으로 사람의 환경이나 외부 시스템이 필요한 것들이다. **이 목록은 짧게 유지한다.**

| 항목 | 왜 어려운가 | 대신 한 것 |
|---|---|---|
| `.app` 빌드본에서의 CLI PATH 동작 | GUI 번들 PATH 는 `tauri dev` 로 재현되지 않는다 | `user_path()` 자체를 테스트로 검증. 릴리스 직전 빌드본에서 1회 확인 |
| 브라우저에서의 Firebase 로그인 그 자체 | 실제 사람의 계정 인증이 필요하다 | **그 이후 서버 흐름 전체는 원격 DB 로 실제 검증했다**(아래) |
| 웹뷰 픽셀 렌더링 | macOS WKWebView 는 WebDriver(`tauri-driver`) 미지원 | 검증 대상 로직을 UI 밖으로 빼서 26개 테스트로 커버 |

### DB 가 필요한 검증 — 로컬 DB 를 띄우지 않는다

**로컬 postgres·로컬 Docker 를 쓰지 않는다.** Docker Desktop 은 화면에 앱이 떠서 사람의 작업을 방해하고,
로컬 DB 는 프로덕션과 스키마가 어긋날 수 있다. **SSH 터널로 원격 getpes.com DB 에 직접 붙어 검증한다.**

```bash
PG_PW=$(ssh root@187.52.114.102 "grep -E '^PG_PW=' /root/pes/.env | cut -d= -f2-" | tr -d '"'"'"' \r\n')
ssh -f -N -L 15433:127.0.0.1:5433 root@187.52.114.102
cd ~/apps/pes/web
DATABASE_URL="postgres://pes:${PG_PW}@127.0.0.1:15433/pes" pnpm vitest run src/lib/server/frai
pkill -f "ssh -f -N -L 15433:"     # 끝나면 닫는다
```

⚠️ **프로덕션 DB 다.** 테스트는 임시 uid(`test-frai-*`)만 만들고 `afterAll` 에서 지우며,
끝난 뒤 **잔여 행이 0 인지 직접 조회해 확인**한다. 기존 데이터를 건드리는 테스트는 만들지 않는다.

**⚠️ macOS 에서는 `tauri-driver` 를 쓸 수 없다.** 그러므로 웹뷰 픽셀 확인에 의존하는 테스트를
설계하지 말고, 확인하고 싶은 로직을 UI 밖으로 빼낸다.

---

## 6. 테스트로 실제로 잡은 결함 (기록)

테스트가 장식이 아니라는 근거로 남긴다.

| 결함 | 어떻게 드러났나 |
|---|---|
| 릴레이 테스트가 서로의 응답을 수신 | 429 테스트가 **정상 응답을 받아** 실패. 전역 환경변수 간섭이 원인이었다 |
| `vite.config.ts` 타입 오류 | `npm run check` 가 `test` 속성을 모른다고 실패 → `vitest/config` 에서 import 하도록 수정 |
| 파싱과 부수효과가 엉킴 | 테스트를 쓸 수 없어서 발견. `parse_claude_line` 순수 함수로 분리 |
