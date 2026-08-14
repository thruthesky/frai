/**
 * 드롭다운의 커서 이동 규칙.
 *
 * 컴포넌트가 아니라 여기에 두는 이유: WKWebView 는 WebDriver 를 지원하지 않아 화면을
 * 띄운 테스트를 만들 수 없고, 창을 띄우는 검증 자체가 금지되어 있다(TEST.md). 그래서
 * "화살표를 눌렀을 때 어디로 가는가" 같은 판단을 UI 밖으로 빼서 node 환경에서 검증한다.
 */

export interface SelectableOption {
  id: string
  /** 사용할 수 없는 항목. 커서가 건너뛴다. */
  disabled?: boolean
}

/**
 * `from` 에서 `dir` 방향으로 한 칸 이동한다. 비활성 항목은 건너뛴다.
 *
 * 목록 끝에서 반대편으로 감싸지 않는다(wrap). 목록형 위젯에서 커서가 갑자기 반대쪽
 * 끝으로 튀면 위치 감각을 잃기 때문이다 — 갈 곳이 없으면 제자리에 머문다.
 */
export function nextEnabled<T extends SelectableOption>(
  options: readonly T[],
  from: number,
  dir: 1 | -1,
): number {
  for (let i = from + dir; i >= 0 && i < options.length; i += dir) {
    if (!options[i].disabled) return i
  }
  return from
}

/** 선택 가능한 첫 항목. 전부 비활성이면 -1. */
export function firstEnabled<T extends SelectableOption>(options: readonly T[]): number {
  return options.findIndex((option) => !option.disabled)
}

/** 선택 가능한 마지막 항목. 전부 비활성이면 -1. */
export function lastEnabled<T extends SelectableOption>(options: readonly T[]): number {
  for (let i = options.length - 1; i >= 0; i--) {
    if (!options[i].disabled) return i
  }
  return -1
}

/** id 로 인덱스를 찾는다. 없으면 -1. */
export function indexOfId<T extends SelectableOption>(
  options: readonly T[],
  id: string,
): number {
  return options.findIndex((option) => option.id === id)
}

/**
 * 드롭다운을 열 때 커서를 놓을 자리.
 * 현재 값이 있으면 거기에, 없거나 그 항목이 비활성이면 선택 가능한 첫 항목에 둔다.
 */
export function initialIndex<T extends SelectableOption>(
  options: readonly T[],
  currentId: string,
): number {
  const found = indexOfId(options, currentId)
  if (found >= 0 && !options[found].disabled) return found
  return firstEnabled(options)
}
