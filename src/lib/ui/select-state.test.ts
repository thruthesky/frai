import { describe, expect, it } from 'vitest'
import {
  firstEnabled,
  indexOfId,
  initialIndex,
  lastEnabled,
  nextEnabled,
} from './select-state'

/** 프로바이더 목록의 실제 모양 — 설치되지 않은 CLI 가 중간에 섞인다. */
const OPTIONS = [
  { id: 'frai-default' },
  { id: 'claude' },
  { id: 'codex', disabled: true },
  { id: 'opencode', disabled: true },
  { id: 'kimi' },
]

describe('nextEnabled', () => {
  it('다음 항목으로 한 칸 이동한다', () => {
    expect(nextEnabled(OPTIONS, 0, 1)).toBe(1)
  })

  it('비활성 항목을 건너뛴다', () => {
    // claude(1) → codex(2, 비활성) · opencode(3, 비활성) 을 지나 kimi(4)
    expect(nextEnabled(OPTIONS, 1, 1)).toBe(4)
  })

  it('위로 이동할 때도 비활성을 건너뛴다', () => {
    expect(nextEnabled(OPTIONS, 4, -1)).toBe(1)
  })

  it('끝에서는 감싸지 않고 제자리에 머문다', () => {
    expect(nextEnabled(OPTIONS, 4, 1)).toBe(4)
    expect(nextEnabled(OPTIONS, 0, -1)).toBe(0)
  })

  it('뒤가 전부 비활성이면 움직이지 않는다', () => {
    const tail = [{ id: 'a' }, { id: 'b', disabled: true }]
    expect(nextEnabled(tail, 0, 1)).toBe(0)
  })

  it('전부 비활성이어도 예외를 던지지 않는다', () => {
    const none = [{ id: 'a', disabled: true }, { id: 'b', disabled: true }]
    expect(nextEnabled(none, 0, 1)).toBe(0)
  })
})

describe('firstEnabled · lastEnabled', () => {
  it('선택 가능한 처음과 끝을 찾는다', () => {
    expect(firstEnabled(OPTIONS)).toBe(0)
    expect(lastEnabled(OPTIONS)).toBe(4)
  })

  it('앞뒤가 비활성이면 안쪽을 찾는다', () => {
    const padded = [{ id: 'a', disabled: true }, { id: 'b' }, { id: 'c', disabled: true }]
    expect(firstEnabled(padded)).toBe(1)
    expect(lastEnabled(padded)).toBe(1)
  })

  it('전부 비활성이면 -1', () => {
    const none = [{ id: 'a', disabled: true }]
    expect(firstEnabled(none)).toBe(-1)
    expect(lastEnabled(none)).toBe(-1)
  })

  it('빈 목록에서도 -1', () => {
    expect(firstEnabled([])).toBe(-1)
    expect(lastEnabled([])).toBe(-1)
  })
})

describe('indexOfId', () => {
  it('id 로 위치를 찾는다', () => {
    expect(indexOfId(OPTIONS, 'kimi')).toBe(4)
  })

  it('없는 id 는 -1', () => {
    expect(indexOfId(OPTIONS, 'ollama')).toBe(-1)
  })
})

describe('initialIndex', () => {
  it('현재 값 위치에서 열린다', () => {
    expect(initialIndex(OPTIONS, 'claude')).toBe(1)
  })

  it('현재 값이 비활성이면 선택 가능한 첫 항목으로 간다', () => {
    // 설치돼 있던 CLI 가 사라진 뒤 다시 열었을 때의 상황
    expect(initialIndex(OPTIONS, 'codex')).toBe(0)
  })

  it('현재 값이 목록에 없어도 첫 항목으로 간다', () => {
    expect(initialIndex(OPTIONS, 'ollama')).toBe(0)
  })
})
