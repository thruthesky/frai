# 제3자 고지 (Third-Party Notices)

FRAI 가 참고하거나 포함한 제3자 저작물을 기록한다.

---

## 1. DeepSeek Harness Desktop — **디자인 참고** (코드 미포함)

2026-08-22, FRAI 의 시각 디자인을 다듬으면서 **DeepSeek Harness Desktop 의 화면을 참고**했다.
무엇을 참고했고 무엇을 하지 않았는지 아래에 명확히 남긴다.

### 참고한 것

- **수치**: radius·행간·여백 같은 치수(예: 입력 카드 `border-radius:22px`, 본문 `16px/24px`)
- **색 체계의 사고방식**: 팔레트를 역할 이름(alias)으로 한 겹 감싸 테마 전환 지점을 모으는 구조
- **상호작용 표현**: 선택·호버를 불투명 색이 아니라 반투명 오버레이로 얹는 방식

### 하지 않은 것

- ❌ **코드·CSS·SVG 를 복사하지 않았다.** FRAI 의 스타일은 Svelte 5 + 순수 CSS 로 새로 작성했다
      (참고 대상은 React + CSS Modules 라 애초에 호환되지 않는다).
- ❌ **`@deepseek-ai/*` 패키지를 의존성으로 넣지 않았다.** `package.json` 에 없다.
- ❌ **브랜드 자산을 가져오지 않았다** — 고래 로고 · `deepseek` 워드마크 · `HARNESS` 배지 ·
      `Into the Unknown` 카피. FRAI 는 자체 마크(인디고 그라디언트)를 쓴다.

### 출처와 라이선스

참고 대상은 **두 겹**이며 라이선스가 서로 다르다. 흔히 "MIT" 로 뭉뚱그리기 쉬우나 사실이 아니다.

| 대상 | 라이선스 | 저작권자 |
| --- | --- | --- |
| 래퍼 저장소 `anywhere-labs/deepseek-harness-desktop` | MIT | Anywhere Labs |
| UI 패키지 `@deepseek-ai/dsh-*` 9개<br>(client-ui-{layout,sidebar,conversation,workspace,theme,primitives,input-trigger} · brand · settings) | **BSD-3-Clause** | **DeepSeek** |
| 유틸 `cosmokit` · `schemastery` | MIT | — |

> ⚠️ 화면의 실제 구현은 **UI 패키지 쪽**이고, 그쪽이 BSD-3-Clause 다.
> 이 패키지들은 `publishConfig.access: "restricted"` 로 배포되어 있다.

```
BSD 3-Clause License
Copyright (c) 2026, DeepSeek
```

전문: https://opensource.org/license/bsd-3-clause

### 왜 코드를 안 넣었는데도 고지하는가

BSD-3-Clause 의 고지 의무는 **코드·바이너리를 재배포할 때** 붙는 조건이다. 위와 같이 수치와
설계 개념만 참고한 경우까지 고지해야 하는 **법적 의무는 없다.** 그럼에도 남기는 이유는
**어디에서 왔는지 추적할 수 있게** 하기 위한 보수적 정책이다.

**앞으로 CSS·SVG·코드를 실제로 복사하는 일이 생기면 그때는 의무가 된다.** 그 경우
이 표에 파일 단위로 추가한다.

### BSD-3-Clause 3조 준수

> *Neither the name of the copyright holder nor the names of its contributors may be used to
> endorse or promote products derived from this software without specific prior written permission.*

**FRAI 의 홍보·마케팅에 DeepSeek 또는 Anywhere Labs 의 이름을 쓰지 않는다.**
"DeepSeek Harness 와 같은 UI" 같은 문구를 랜딩·릴리스 노트·스토어 설명에 넣지 않는다.

---

## 2. Lucide — 아이콘 규격

`src/renderer/lib/ui/icons.ts` 의 path 데이터는 [Lucide](https://lucide.dev) 규격
(24×24, stroke-width 1.75, 둥근 끝)을 따른다. Lucide 는 **ISC License** 다.

```
ISC License
Copyright (c) for portions of Lucide are held by Cole Bemis 2013-2022 as part of Feather (MIT).
All other copyright (c) for Lucide are held by Lucide Contributors 2022.
```

---

## 3. 런타임 의존성

앱에 실제로 포함되는 패키지의 라이선스는 `package.json` 의 `dependencies` 와
`npm ls --omit=dev` 로 확인한다. 현재 런타임 의존성은 `electron-updater` 하나다.
