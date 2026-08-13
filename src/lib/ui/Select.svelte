<script lang="ts">
  import type { ProviderInfo } from '../types'
  import Icon from './Icon.svelte'
  import { firstEnabled, initialIndex, lastEnabled, nextEnabled } from './select-state'

  /**
   * 프로바이더 선택 드롭다운.
   *
   * 네이티브 `<select>` 를 대신한다. 두 가지를 얻는다 — 앱이 브라우저 위젯처럼 보이지
   * 않게 되는 것과, 옵션 행 안에 "로컬 / 서버 경유" 배지와 사용 불가 사유를 함께 보여줄
   * 수 있게 되는 것. 후자는 고르기 전에 알아야 하는 정보라 실질적인 이득이 크다.
   */
  interface Props {
    value: string
    options: ProviderInfo[]
    disabled?: boolean
    onchange: (id: string) => void
  }

  let { value, options, disabled = false, onchange }: Props = $props()

  let open = $state(false)
  let active = $state(0)
  let trigger = $state<HTMLButtonElement | null>(null)
  let panel = $state<HTMLDivElement | null>(null)
  let box = $state({ top: 0, left: 0, width: 0 })

  const uid = `frai-select-${++seq}`
  const current = $derived(options.find((option) => option.id === value))
  /** select-state 는 `disabled` 를 보고, ProviderInfo 는 `available` 을 준다. */
  const items = $derived(options.map((option) => ({ id: option.id, disabled: !option.available })))

  const optionId = (index: number) => `${uid}-opt-${index}`

  /**
   * 패널을 화면 좌표에 놓는다.
   *
   * 카드(.card)가 `overflow: hidden` 이라 그 안에 절대 위치로 두면 잘린다. 그 규칙은
   * 카드의 둥근 모서리 클리핑을 담당하므로 풀 수 없다 — 그래서 패널만 `position: fixed`
   * 로 문서 최상단에 띄우고 좌표를 직접 계산한다.
   */
  function place() {
    if (!trigger) return
    const rect = trigger.getBoundingClientRect()
    const width = Math.max(rect.width, 240)
    const spaceBelow = window.innerHeight - rect.bottom - 8
    // 아래가 좁고 위가 더 넓으면 위로 펼친다.
    const openUp = spaceBelow < 160 && rect.top > spaceBelow
    box = {
      top: openUp ? Math.max(8, rect.top - PANEL_MAX_H - 4) : rect.bottom + 4,
      left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)),
      width,
    }
  }

  function openPanel() {
    if (disabled) return
    active = initialIndex(items, value)
    place()
    open = true
  }

  function commit(index: number) {
    const option = options[index]
    if (!option || !option.available) return
    onchange(option.id)
    open = false
    trigger?.focus()
  }

  /**
   * 포커스는 트리거에 계속 두고 `aria-activedescendant` 로 커서만 옮긴다(가상 포커스).
   * 실제 포커스를 옵션으로 옮기면 포커스 트랩과 복원 로직이 필요해지는데, 이 위젯은
   * 모달이 아니라 그럴 이유가 없다. Escape 처리도 "닫기" 한 줄로 끝난다.
   */
  function onKeydown(event: KeyboardEvent) {
    if (!open) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        openPanel()
      }
      return
    }

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault()
        active = nextEnabled(items, active, 1)
        break
      case 'ArrowUp':
        event.preventDefault()
        active = nextEnabled(items, active, -1)
        break
      case 'Home':
        event.preventDefault()
        active = firstEnabled(items)
        break
      case 'End':
        event.preventDefault()
        active = lastEnabled(items)
        break
      case 'Enter':
      case ' ':
        event.preventDefault()
        commit(active)
        break
      case 'Escape':
        event.preventDefault()
        open = false
        break
      case 'Tab':
        // 막지 않는다 — 닫고 다음 컨트롤로 넘어가는 것이 기대되는 동작이다.
        open = false
        break
    }
  }

  $effect(() => {
    if (!open) return

    // capture 단계에서 잡아야 카드 안의 다른 핸들러보다 먼저 판단할 수 있다.
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node
      if (!trigger?.contains(target) && !panel?.contains(target)) open = false
    }
    // 열린 채로 스크롤하면 fixed 패널만 제자리에 남아 트리거와 어긋난다.
    // 좌표를 매 프레임 다시 계산하는 것보다 닫는 편이 단순하고 오작동이 없다.
    const dismiss = () => {
      open = false
    }

    document.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('resize', dismiss)
    window.addEventListener('scroll', dismiss, true)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('resize', dismiss)
      window.removeEventListener('scroll', dismiss, true)
    }
  })
</script>

<script lang="ts" module>
  /** 인스턴스마다 고유한 id 가 필요하다(aria-controls·aria-activedescendant). */
  let seq = 0
  const PANEL_MAX_H = 260
</script>

<button
  bind:this={trigger}
  type="button"
  class="trigger"
  role="combobox"
  aria-haspopup="listbox"
  aria-expanded={open}
  aria-controls={open ? uid : undefined}
  aria-activedescendant={open && active >= 0 ? optionId(active) : undefined}
  aria-label="프로바이더 선택"
  {disabled}
  onclick={() => (open ? (open = false) : openPanel())}
  onkeydown={onKeydown}
>
  <span class="trigger-label">{current?.label ?? value}</span>
  <Icon name="chevronDown" size={13} />
</button>

<!-- 열려 있을 때만 DOM 에 만든다. 세션 9개 × 옵션 6개를 상시 유지하면 그리드가 무거워진다. -->
{#if open}
  <!-- style: 디렉티브는 HTML style 속성이 아니라 런타임 setProperty 호출로 컴파일된다.
       위치는 계산값이라 클래스로 표현할 수 없는 유일한 부분이다. -->
  <div
    bind:this={panel}
    id={uid}
    class="panel"
    role="listbox"
    aria-label="프로바이더 목록"
    style:top="{box.top}px"
    style:left="{box.left}px"
    style:width="{box.width}px"
    style:max-height="{PANEL_MAX_H}px"
  >
    {#each options as option, index (option.id)}
      <!--
        키보드 처리가 이 요소에 없는 것은 의도다. 이 목록은 aria-activedescendant
        방식이라 실제 포커스는 트리거 버튼에 머물고 화살표·Enter·Escape 를 전부
        거기서 받는다(onKeydown). 옵션에 핸들러를 달면 도달할 수 없는 죽은 코드가 된다.
        tabindex="-1" 은 포커스를 받기 위해서가 아니라, 이 요소가 목록의 일원임을
        보조기술에 알리고 Tab 순서에서는 빠지게 하려는 것이다.
      -->
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <div
        id={optionId(index)}
        class="option"
        class:active={index === active}
        class:unavailable={!option.available}
        role="option"
        tabindex={-1}
        aria-selected={option.id === value}
        aria-disabled={!option.available}
        onclick={() => commit(index)}
        onpointerenter={() => {
          if (option.available) active = index
        }}
      >
        <span class="option-row">
          {#if option.leavesDevice}
            <Icon name="globe" size={12} />
          {:else if option.kind === 'cli'}
            <Icon name="cpu" size={12} />
          {/if}

          <span class="option-label">{option.label}</span>

          {#if option.leavesDevice}
            <span class="option-badge warn">서버 경유</span>
          {:else if option.kind === 'cli'}
            <span class="option-badge ok">로컬</span>
          {/if}

          {#if option.id === value}
            <Icon name="check" size={13} />
          {/if}
        </span>

        {#if option.reason}
          <span class="option-reason">{option.reason}</span>
        {/if}
      </div>
    {/each}
  </div>
{/if}

<style>
  .trigger {
    max-width: 100%;
    min-width: 0;
    justify-content: space-between;
    gap: var(--space-1);
    padding: var(--space-1) var(--space-2);
    font-size: var(--fs-sm);
  }
  .trigger-label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .trigger[aria-expanded='true'] {
    border-color: var(--accent);
  }

  .panel {
    position: fixed;
    z-index: 50;
    overflow-y: auto;
    padding: var(--space-1);
    background: var(--surface-3);
    border: 1px solid var(--line-strong);
    border-radius: var(--r-md);
    /* 떠 있는 표면이므로 카드보다 강한 그림자를 쓴다. */
    box-shadow: var(--shadow-2);
  }

  .option {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: var(--space-2);
    border-radius: var(--r-sm);
    cursor: pointer;
  }
  .option.active {
    background: var(--accent-bg);
  }
  .option.unavailable {
    opacity: 0.5;
    cursor: default;
  }

  .option-row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--fs-sm);
  }
  .option-label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .option-badge {
    margin-inline-start: auto;
    font-size: var(--fs-xs);
    padding: 1px var(--space-2);
    border-radius: var(--r-full);
    white-space: nowrap;
  }
  .option-badge.warn {
    background: var(--warn-bg);
    color: var(--warn);
  }
  .option-badge.ok {
    background: var(--ok-bg);
    color: var(--ok);
  }

  .option-reason {
    font-size: var(--fs-xs);
    color: var(--muted);
    line-height: 1.4;
  }
</style>
