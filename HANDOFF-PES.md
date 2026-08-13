# PES 팀 전달 — FRAI 데스크톱 앱 로그인 서버 구현

작성: FRAI 쪽 작업자 · 대상 저장소: `~/apps/pes`

---

## 한 줄 요약

FRAI(macOS 데스크톱 앱)가 PES 계정으로 로그인할 수 있도록 **OAuth 유사 + PKCE 엔드포인트 3개와 테이블 2개**를 추가했습니다. 코드는 **미커밋·미배포**이고, **DB 마이그레이션만 프로덕션에 이미 적용**되어 있습니다.

---

## ⚠️ 먼저 알아야 할 것 두 가지

### 1. 프로덕션 DB 에 마이그레이션 0019 가 이미 적용되어 있습니다

검증을 위해 원격 DB(`pes-postgres-1`)에 **drizzle 로** 적용했습니다. `psql` 직접 실행이 아니라
`pnpm db:migrate` 를 썼으므로 **`drizzle.__drizzle_migrations` 이력에 정상 등록**되어 있습니다.

```
web.frai_auth_codes   생성됨
web.frai_tokens       생성됨
```

- 다음 배포 때 drizzle 이 0019 를 **이미 적용된 것으로 인식하고 건너뜁니다.** 중복 적용 걱정은 없습니다.
- 현재는 **테이블만 있고 이를 쓰는 코드는 서버에 없는 상태**입니다. 기존 기능에는 영향이 없습니다
  (신규 테이블 2개 추가일 뿐, 기존 테이블은 건드리지 않았습니다).
- 테스트로 만든 임시 데이터는 전부 삭제했고 잔여 0 을 직접 확인했습니다.

### 2. 작업 트리에 제 것이 아닌 미커밋 변경이 섞여 있습니다

`git add .` 로 한 번에 커밋하면 **다른 분의 미완성 작업까지 함께 들어갑니다.** 아래 목록만 골라 주세요.

**제가 추가/수정한 파일 (이것만 커밋 대상)**

```
web/src/lib/server/db/schema.ts          (수정 — 51줄 추가, frai 테이블 2개만)
web/drizzle/0019_modern_rafael_vega.sql  (신규)
web/drizzle/meta/0019_snapshot.json      (신규)
web/drizzle/meta/_journal.json           (수정 — 0019 등록만)
web/src/lib/server/frai/pkce.ts          (신규)
web/src/lib/server/frai/auth.ts          (신규)
web/src/lib/server/frai/pkce.test.ts     (신규)
web/src/lib/server/frai/auth.integration.test.ts (신규)
web/src/routes/frai/auth/+server.ts                  (신규)
web/src/routes/frai/api/auth/exchange/+server.ts     (신규)
web/src/routes/frai/api/auth/revoke/+server.ts       (신규)
```

**제가 건드리지 않은 것** — `hooks.server.ts`·`hooks.ts`·`vite.config.ts`·`typing/*`·`.cowork/*`·`.claude/skills/*` 등의
수정은 제 작업이 아닙니다. (특히 `hooks.server.ts` 는 의도적으로 손대지 않았습니다. 아래 참고)

---

## 무엇을 만들었나

### 엔드포인트

| 메서드·경로 | 역할 |
|---|---|
| `GET /frai/auth` | 앱이 시스템 브라우저로 여는 진입점. 로그인 확인 → 일회용 code 발급 → 루프백으로 302 |
| `POST /frai/api/auth/exchange` | code + PKCE verifier → FRAI 전용 토큰 발급 |
| `POST /frai/api/auth/revoke` | 토큰 폐기(앱 로그아웃) |

### 흐름

```
앱: 127.0.0.1:<임의포트> 에 1회용 서버 기동 → 브라우저로 /frai/auth 열기
      ?redirect_uri=http://127.0.0.1:<port>/callback
      &state=<난수> &code_challenge=<S256> &code_challenge_method=S256

서버: 미로그인 → /login?next=... 로 유도 (로그인 후 복귀)
      로그인 → code 발급 → 302 redirect_uri?code=..&state=..

앱: POST /frai/api/auth/exchange { code, codeVerifier, redirectUri }
서버: SHA256(verifier) == 저장된 challenge 확인 → 토큰 발급

이후: Authorization: Bearer <token>
```

### 파일 구조 (순수 로직 / DB 분리)

- `lib/server/frai/pkce.ts` — **DB 를 건드리지 않는 순수 검증** (redirect_uri 허용범위·PKCE·Bearer 파싱)
- `lib/server/frai/auth.ts` — DB 접근 (code 발급·교환·토큰 검증·폐기·만료 청소)

분리한 이유: 순수 함수가 `$lib/server/db` 를 import 하면 `DATABASE_URL` 없이는 테스트가 아예 실행되지
않습니다. 실제로 처음엔 그래서 테스트가 안 돌았습니다.

---

## 검토해 주셨으면 하는 지점

1. **`isAllowedRedirectUri`** (`pkce.ts`) — 오픈 리다이렉트 방어의 전부입니다.
   `http` + `127.0.0.1` + `/callback` + 포트 1024~65535 만 허용하고, `localhost`·`[::1]`·`0.0.0.0`·
   userinfo·fragment 를 전부 거부합니다. 더 조여야 할 게 있는지 봐 주세요.

2. **토큰 저장 방식** — 평문을 저장하지 않고 **SHA-256 해시만** 넣습니다. DB 가 유출돼도 토큰을 복원할 수 없습니다.

3. **code 1회 사용** — 조회 후 갱신이 아니라 **조건부 UPDATE(`used_at IS NULL`) + RETURNING** 으로 처리해
   동시 교환 시 한쪽만 성공하게 했습니다.

4. **실패 사유 비노출** — "code 없음 / 이미 씀 / PKCE 불일치" 를 응답에서 구분하지 않고 일괄 `400` 입니다.
   사유는 서버 로그에만 남습니다.

5. **레이트리밋** — `checkRateLimit` 을 재사용했습니다. `/frai/auth` 는 uid 20회/분 + IP 60회/분,
   `exchange`·`revoke` 는 IP 30회/분입니다. 수치 조정 의견 주시면 반영하겠습니다.

6. **`purgeExpiredAuthCodes()`** 를 만들어 뒀지만 **아직 아무도 호출하지 않습니다.**
   code 행이 계속 쌓이므로 크론이나 요청 시 확률적 호출을 붙이는 게 좋겠습니다. 판단 부탁드립니다.

---

## 의도적으로 하지 않은 것

**`hooks.server.ts` 를 수정하지 않았습니다.**

`/frai/auth` 는 브라우저 요청(GET + `Accept: text/html`)이라 `detectLocaleHandle` 의 언어 감지에 걸려
`/ko/frai/auth` 로 302 가 한 번 더 붙습니다. 확인해보니 **reroute 훅이 라우트를 정상 매칭하고 쿼리도
보존되어 기능상 문제가 없어서**, 핵심 파일을 건드리는 위험을 감수하지 않았습니다.

리다이렉트를 줄이고 싶다면 `isAsset` 조건에 `/frai/auth` 를 추가하면 되지만, **판단은 PES 팀에 맡깁니다.**

---

## 테스트

```bash
cd ~/apps/pes/web

# 순수 로직 (DB 불필요) — 10개
pnpm vitest run src/lib/server/frai/pkce.test.ts

# DB 경로 — 8개. 원격 DB 에 터널을 뚫고 돌립니다(로컬 DB·Docker 를 쓰지 않습니다)
PG_PW=$(ssh root@187.52.114.102 "grep -E '^PG_PW=' /root/pes/.env | cut -d= -f2-" | tr -d '"'"'"' \r\n')
ssh -f -N -L 15433:127.0.0.1:5433 root@187.52.114.102
DATABASE_URL="postgres://pes:${PG_PW}@127.0.0.1:15433/pes" pnpm vitest run src/lib/server/frai
pkill -f "ssh -f -N -L 15433:"
```

**현재 결과**

| 항목 | 결과 |
|---|---|
| 순수 로직 (`pkce.test.ts`) | 10개 통과 |
| DB 경로 (`auth.integration.test.ts`) — **원격 프로덕션 DB 로 실제 실행** | 8개 통과 |
| PES 전체 (`pnpm test`) | 388개 통과 (기존 테스트 회귀 없음) |
| 타입 (`pnpm check`) | 6471 파일 0 에러 |

DB 테스트가 검증하는 것: 정상 교환 · **code 재사용 거부** · **verifier 불일치 거부** ·
redirect_uri 불일치 거부 · 만료 거부 · **토큰이 해시로만 저장됨** · 폐기 토큰 거부 · 없는 토큰 거부.

라우트는 dev 서버에 curl 로 직접 호출해 확인했습니다: 외부 호스트 400 / method 누락 400 /
challenge 형식 오류 400 / 미로그인 302 `/login?next=...` / exchange·revoke 400·401.

---

## 남은 일

1. **커밋** — 위 목록만 선택해서. (다른 분의 미커밋 작업이 섞여 있어 제가 커밋하지 않았습니다)
2. **배포** — `~/apps/pes/DEPLOY.md` 절차. 배포 전까지 `https://getpes.com/frai/auth` 는 **404** 입니다.
   현재 FRAI 앱에서 로그인 버튼을 누르면 브라우저가 열리고 404 를 보게 됩니다.
3. `purgeExpiredAuthCodes()` 호출 지점 결정 (위 6번)

---

## 참고

- FRAI 앱 쪽 구현은 `~/apps/frai/src-tauri/src/auth.rs` 입니다. 규약이 어긋나면 앱도 함께 고쳐야 합니다.
- 규약 전문과 설계 배경은 `~/apps/frai/CLAUDE.md` 의 "계정 · 데이터 동기화" 절에 있습니다.
- 앞으로 FRAI 관련해 PES 에 더 필요한 것: **기본 AI 릴레이**(`POST /frai/api/chat`, DeepSeek 경유) 와
  **세션 목록 동기화**(`frai_sessions`·`frai_columns`), **랜딩 페이지**(`/frai/`, 7개 국어).
  각각의 규약도 위 문서에 정리되어 있습니다.
