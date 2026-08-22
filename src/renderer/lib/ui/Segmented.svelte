<script lang="ts" generics="T extends string | number">
  /**
   * 세그먼티드 컨트롤 — 값이 서너 개뿐인 선택지에 쓴다.
   *
   * `<input type="range">` 를 대신한다. 열 개수는 1~4 네 단계뿐이라 슬라이더가 과했고,
   * 무엇보다 네이티브 range 는 어떤 CSS 를 발라도 "브라우저 위젯"으로 보인다.
   */
  interface Props {
    value: T
    options: { value: T; label: string }[]
    /** 그룹의 접근 가능한 이름. 라디오 그룹에는 반드시 필요하다. */
    ariaLabel: string
    onchange: (value: T) => void
  }

  let { value, options, ariaLabel, onchange }: Props = $props()

  let group = $state<HTMLDivElement | null>(null)

  /**
   * 라디오 그룹의 표준 키보드 동작 — 좌우(상하) 화살표로 이동하며 즉시 선택된다.
   * 포커스는 roving tabindex 로 선택된 항목 하나만 받는다.
   */
  function onKeydown(event: KeyboardEvent, index: number) {
    const step =
      event.key === 'ArrowRight' || event.key === 'ArrowDown'
        ? 1
        : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
          ? -1
          : 0
    if (step === 0) return

    event.preventDefault()
    const next = (index + step + options.length) % options.length
    onchange(options[next].value)
    // 화살표 이동은 포커스도 따라가야 한다.
    const buttons = group?.querySelectorAll<HTMLButtonElement>('button')
    buttons?.[next]?.focus()
  }
</script>

<div class="segmented" role="radiogroup" aria-label={ariaLabel} bind:this={group}>
  {#each options as option, index (option.value)}
    {@const selected = option.value === value}
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      tabindex={selected ? 0 : -1}
      class:on={selected}
      onclick={() => onchange(option.value)}
      onkeydown={(event) => onKeydown(event, index)}
    >
      {option.label}
    </button>
  {/each}
</div>

<style>
  .segmented {
    display: flex;
    gap: 2px;
    /* 컨테이너 배경(--surface-3) 위에 활성 배경(--surface-1)을 또 얹으면 배경이 두 겹이
       되어 28px 짜리 컨트롤이 실제보다 무거워 보인다. 테두리 한 겹으로 묶고 안은 비운다. */
    border: 1px solid var(--line);
    border-radius: var(--r-md);
    padding: 2px;
  }

  .segmented button {
    border: none;
    background: transparent;
    color: var(--muted);
    font-size: var(--fs-sm);
    padding: var(--space-1) var(--space-3);
    border-radius: var(--r-sm);
    min-width: 28px;
  }
  .segmented button:hover:not(.on) {
    background: var(--overlay-hover);
    color: var(--fg);
  }
  .segmented button.on {
    background: var(--overlay-active);
    color: var(--accent);
    font-weight: var(--fw-medium);
    /* ⚠️ 그림자를 넣지 말 것. 28px 컨트롤에서는 층이 생기는 게 아니라 번져 보인다. */
  }
</style>
