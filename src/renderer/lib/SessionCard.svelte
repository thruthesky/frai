<script lang="ts">
  import { store, type Session } from './sessions.svelte'
  import Icon from './ui/Icon.svelte'
  import Select from './ui/Select.svelte'

  let { session }: { session: Session } = $props()

  /**
   * 빈 칸에 놓는 예시. 누르면 입력창에 채워진다.
   *
   * 라벨과 실제 프롬프트를 나눈 이유: 칸이 넷이면 같은 칩이 네 번 반복되므로
   * 라벨은 한 줄에 들어갈 만큼 짧아야 하고, 입력창에 들어갈 문장은 그대로 보낼 수
   * 있을 만큼 온전해야 한다.
   */
  const SUGGESTIONS = [
    { label: '버그 찾기', prompt: '이 코드의 버그를 찾아줘' },
    { label: '리팩터링', prompt: '더 간단하게 리팩터링해줘' },
    { label: '테스트 작성', prompt: '테스트 코드를 작성해줘' },
  ]

  let input = $state('')
  let scroller = $state<HTMLDivElement | null>(null)
  let box = $state<HTMLTextAreaElement | null>(null)
  /** :focus-within 을 쓰지 않는 이유: 전송 버튼을 눌러도 틀 전체가 켜져 산만하다. */
  let inputFocused = $state(false)

  const provider = $derived(store.provider(session.providerId))
  const canRemove = $derived(store.sessions.length > 1)
  /** 3열부터는 칸 너비가 300px 아래로 내려가 예시 칩이 들어가지 않는다. */
  const narrow = $derived(store.columns >= 3)

  function useSuggestion(text: string) {
    input = text
    box?.focus()
  }
  /** 제목은 첫 질문에서 만들어지므로, 질문이 없으면 "새 세션 s1" 같은 소음이 된다. */
  const hasQuestion = $derived(session.messages.some((m) => m.role === 'user'))

  /**
   * 사용자가 위로 올려 읽는 중인가. 새 내용이 붙어도 그때는 따라가지 않는다.
   *
   * 이 판정을 청크마다 하면 scrollHeight·scrollTop·clientHeight 를 읽느라 매번
   * 레이아웃이 강제로 확정된다(forced synchronous layout). 세션 6~9개가 각각
   * 초당 수십 청크를 받으면 프레임마다 그 계산이 반복된다. 그래서 값을 읽는 일은
   * 실제로 스크롤이 일어날 때만 하고, 청크가 붙을 때는 캐시된 결과만 본다.
   */
  let atBottom = $state(true)

  function onScroll() {
    if (!scroller) return
    atBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 120
  }

  $effect(() => {
    const lastLength = session.messages[session.messages.length - 1]?.content.length
    void lastLength
    if (!scroller || !atBottom) return
    // 같은 프레임에 청크가 여러 번 와도 쓰기는 한 번만 하도록 묶는다.
    const el = scroller
    const frame = requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight
    })
    return () => cancelAnimationFrame(frame)
  })

  function submit() {
    const text = input
    input = ''
    void store.send(session, text)
  }

  function onKeydown(e: KeyboardEvent) {
    // Enter 전송, Shift+Enter 줄바꿈.
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault()
      submit()
    }
  }
</script>

<!--
  선택(chosen)과 스트리밍(busy)은 서로 다른 축이라 표현 수단을 나눈다 —
  선택은 카드 전체의 밝기로, 스트리밍은 테두리 색으로. 둘은 동시에 성립할 수 있다.
-->
<section class="card" class:busy={session.streaming} class:chosen={session.selected}>
  <header>
    <!--
      네이티브 checkbox 대신 토글 버튼을 쓴다. 카드 전체를 클릭 대상으로 만들지 않는
      이유는 카드 안에 textarea·스크롤 영역이 있어 텍스트 선택·입력과 충돌하기 때문이다.
    -->
    <button
      class="pick"
      type="button"
      aria-pressed={session.selected}
      title="전체 전송 대상에 포함"
      aria-label="전체 전송 대상에 포함"
      onclick={() => (session.selected = !session.selected)}
    >
      <Icon name="check" size={12} />
    </button>

    <div class="provider">
      <Select
        value={session.providerId}
        options={store.providers}
        disabled={session.streaming}
        onchange={(id) => (session.providerId = id)}
      />
    </div>

    {#if provider?.leavesDevice}
      <span class="tag warn" title="이 경로는 대화 내용이 getpes.com 서버를 지납니다.">
        <Icon name="globe" size={11} />
        <span class="tag-label">서버 경유</span>
      </span>
    {:else if provider?.kind === 'cli'}
      <span class="tag ok" title="로컬에서 실행됩니다. 추가 비용이 없습니다.">
        <Icon name="cpu" size={11} />
        <span class="tag-label">로컬</span>
      </span>
    {/if}

    <span class="spacer"></span>

    {#if session.streaming}
      <button class="ghost" onclick={() => store.cancel(session)} aria-label="응답 중단">
        <Icon name="stop" size={13} />
        <span class="btn-label">중단</span>
      </button>
    {/if}
    {#if canRemove}
      <button
        class="ghost"
        onclick={() => store.remove(session)}
        title="세션 닫기"
        aria-label="이 세션 닫기"
      >
        <Icon name="x" />
      </button>
    {/if}
  </header>

  <!-- 제목은 좁은 열에서 숨긴다(App.svelte 의 data-cols 규칙). 4열에서는 카드 너비가
       190px 안팎이라 헤더만으로도 이미 빠듯하다. -->
  {#if hasQuestion}
    <p class="session-title" title={session.displayTitle}>{session.displayTitle}</p>
  {/if}

  {#if provider?.reason}
    <p class="notice">{provider.reason}</p>
  {/if}

  <div class="messages" bind:this={scroller} onscroll={onScroll}>
    {#each session.messages as m, i (i)}
      <div class="msg {m.role}">
        <span class="who">{m.role === 'user' ? '나' : provider?.label ?? 'AI'}</span>
        <div class="body">{m.content}{#if !m.done}<span class="caret"></span>{/if}</div>
      </div>
    {/each}

    {#if session.messages.length === 0}
      <!--
        빈 칸이 화면의 대부분을 차지한다(4칸이면 화면의 8할). 회색 한 줄만 두면
        앱 전체가 미완성으로 보이므로, 이 자리에 "이 칸이 어떤 AI 인지" 와
        "무엇을 물으면 되는지" 를 넣는다.
      -->
      <div class="empty">
        <span class="empty-mark" class:relay={provider?.leavesDevice}>
          <Icon name={provider?.kind === 'cli' ? 'cpu' : 'globe'} size={20} />
        </span>
        <p class="empty-hint">무엇을 물어볼까요?</p>

        {#if !narrow}
          <!-- 좁은 열에서는 숨긴다. 3열 이상이면 칩이 한 줄에 들어가지 않는다. -->
          <div class="chips">
            {#each SUGGESTIONS as suggestion (suggestion.label)}
              <button
                class="chip"
                type="button"
                title={suggestion.prompt}
                onclick={() => useSuggestion(suggestion.prompt)}
              >
                {suggestion.label}
              </button>
            {/each}
          </div>
        {/if}
      </div>
    {/if}

    {#if session.error}
      <p class="error">
        <Icon name="alert" size={14} />
        <span>{session.error}</span>
      </p>
    {/if}
  </div>

  <!-- 입력칸과 전송 버튼을 하나의 틀로 묶는다. 둘이 따로 놓인 사각형이면 폼처럼
       보이고, 묶으면 대화창으로 읽힌다. 포커스 링도 이 틀 하나에만 걸린다. -->
  <footer>
    <div class="composer" class:focused={inputFocused}>
      <textarea
        bind:this={box}
        bind:value={input}
        onkeydown={onKeydown}
        onfocus={() => (inputFocused = true)}
        onblur={() => (inputFocused = false)}
        rows="1"
        placeholder="메시지 입력 (Enter 전송 · Shift+Enter 줄바꿈)"
        disabled={session.streaming}
      ></textarea>
      <button
        class="submit"
        class:primary={!!input.trim() && !session.streaming}
        onclick={submit}
        disabled={session.streaming || !input.trim()}
        aria-label="보내기"
      >
        <Icon name="send" size={14} />
      </button>
    </div>
  </footer>

  {#if session.usage}
    <!-- 스트리밍 중이면 이 숫자는 직전 응답의 것이다. 지우지 않고 흐리게 둔다 —
         지우면 여러 칸을 비교하던 중에 값이 한꺼번에 사라진다. -->
    <div class="usage" class:stale={session.streaming}>
      {#if session.usage.remainingFree !== null}
        <span>오늘 남은 무료 {session.usage.remainingFree}회</span>
      {/if}
      {#if session.usage.costUsd !== null}
        <span>{session.usage.costUsd === 0 ? '추가 비용 없음' : `$${session.usage.costUsd.toFixed(4)}`}</span>
      {/if}
      {#if session.usage.outputTokens !== null}
        <span>출력 {session.usage.outputTokens} 토큰</span>
      {/if}
    </div>
  {/if}
</section>

<style>
  .card {
    display: flex;
    flex-direction: column;
    min-height: 0;
    background: var(--surface-1);
    border: 1px solid var(--line);
    border-radius: var(--r-lg);
    /* 테두리만으로 나누면 표처럼 보인다. 얕은 그림자가 카드를 배경에서 띄운다. */
    box-shadow: var(--shadow-1);
    /* ⚠️ 이 overflow 를 풀지 말 것. 헤더 배경과 메시지 스크롤 콘텐츠의 모서리
       클리핑을 이것 하나가 담당한다. 드롭다운 패널은 카드 밖으로 나가야 하므로
       잘리지 않게 position:fixed 로 띄운다(Select.svelte). */
    overflow: hidden;
    transition:
      border-color var(--dur) var(--ease),
      box-shadow var(--dur) var(--ease),
      opacity var(--dur) var(--ease);
  }
  /* 커서가 올라간 칸이 한 단 떠오른다. 칸이 여럿일 때 "지금 다루는 것" 이
     어느 것인지 알려주는 신호이며, 정적인 격자에 생기를 준다. */
  .card:hover {
    box-shadow: var(--shadow-2);
  }
  .card.busy {
    border-color: var(--accent-strong);
  }
  /* 선택된 것을 강조하는 대신 선택 안 된 것을 물러나게 한다. 기본값이 "전부 선택"
     이라(sessions.svelte.ts 의 selected = true) 강조 방식을 쓰면 첫 화면이 통째로
     accent 덩어리가 된다. */
  .card:not(.chosen) {
    opacity: 0.62;
  }
  .card:not(.chosen):hover {
    opacity: 0.85;
  }

  .pick {
    width: 18px;
    height: 18px;
    padding: 0;
    justify-content: center;
    border-radius: var(--r-sm);
    background: transparent;
    border-color: var(--line-strong);
    /* 체크 표시는 선택됐을 때만 보인다. 자리는 늘 차지해 레이아웃이 흔들리지 않는다. */
    color: transparent;
  }
  .pick[aria-pressed='true'] {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--on-accent);
  }
  .pick:hover:not([aria-pressed='true']) {
    background: var(--overlay-hover);
    border-color: var(--line-strong);
  }

  .session-title {
    margin: 0;
    padding: var(--space-2) var(--space-3);
    font-size: var(--fs-sm);
    font-weight: var(--fw-medium);
    color: var(--fg);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    border-bottom: 1px solid var(--line);
    background: var(--surface-2);
  }

  /* 헤더에 별도 배경을 깔지 않는다. 카드마다 색 띠가 하나씩 생기면 격자 전체가
     표처럼 보인다. 경계선 한 줄로 충분하다. */
  header {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    border-bottom: 1px solid var(--line);
  }
  .spacer {
    flex: 1;
  }

  /* 헤더가 좁아지면 프로바이더 이름이 먼저 줄어들도록 한다. 배지·닫기 버튼은
     nowrap 이라 줄지 않으므로, 유일하게 양보할 수 있는 것이 여기다. */
  .provider {
    min-width: 0;
    max-width: 160px;
    flex: 1 1 auto;
  }

  .tag {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    font-size: var(--fs-xs);
    padding: 2px var(--space-2);
    border-radius: var(--r-full);
    white-space: nowrap;
  }
  .tag.warn {
    background: var(--warn-bg);
    color: var(--warn);
  }
  .tag.ok {
    background: var(--ok-bg);
    color: var(--ok);
  }

  .notice {
    margin: 0;
    padding: var(--space-2) var(--space-3);
    font-size: var(--fs-xs);
    color: var(--muted);
    background: var(--surface-2);
    border-bottom: 1px solid var(--line);
  }

  .messages {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: var(--space-3);
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .msg .who {
    display: block;
    font-size: var(--fs-xs);
    font-weight: var(--fw-medium);
    /* 말한 주체는 훑어볼 때만 필요한 정보다. 본문보다 확실히 뒤로 물린다. */
    color: var(--muted);
    letter-spacing: 0.02em;
    margin-bottom: var(--space-1);
  }
  .msg .body {
    white-space: pre-wrap;
    word-break: break-word;
    font-size: var(--fs-md);
    line-height: 1.65;
  }
  /* 내가 쓴 말만 버블로 감싼다. 양쪽 다 버블이면 긴 답변이 색 덩어리가 되어
     읽기 어렵다 — 답변은 카드 배경 위의 본문으로 둔다. */
  .msg.user .body {
    background: var(--accent-bg);
    color: var(--fg);
    padding: var(--space-2) var(--space-3);
    border-radius: var(--r-md);
  }

  .caret {
    display: inline-block;
    width: 7px;
    height: var(--fs-md);
    margin-inline-start: 2px;
    background: var(--accent);
    vertical-align: text-bottom;
    /* visibility 대신 opacity 를 쓴다 — 페인트가 아니라 합성 단계에서 처리되어
       세션 9개가 동시에 깜빡여도 부담이 적다. reduce 설정에서는 app.css 의
       전역 규칙이 이 애니메이션을 멈춘다. */
    animation: blink 1s steps(2, start) infinite;
  }
  @keyframes blink {
    to {
      opacity: 0;
    }
  }

  /* 칸이 넷이면 이 블록이 네 번 반복된다. 프로바이더 이름·설명을 여기 두면 헤더와
     같은 말을 여덟 번 하는 셈이라, 헤더에 없는 것(다음 행동)만 남겼다. */
  .empty {
    margin: auto;
    padding: var(--space-3);
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    max-width: 340px;
  }
  /* 아이콘 색은 헤더 배지와 맞추되(같은 사실을 같은 색으로), 원 배경은 중성으로
     둔다. 색 원을 칸마다 하나씩 채워 넣었더니 빈 화면에서 그 원 넷이 가장 강한
     요소가 되어, 보조 정보인 경로 표시가 위계를 뒤집었다. */
  .empty-mark {
    display: grid;
    place-items: center;
    width: 38px;
    height: 38px;
    border-radius: var(--r-full);
    background: var(--surface-3);
    color: var(--ok);
    margin-block-end: var(--space-3);
  }
  .empty-mark.relay {
    color: var(--warn);
  }
  .empty-hint {
    margin: 0;
    font-size: var(--fs-sm);
    color: var(--muted);
  }

  .chips {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: var(--space-2);
    margin-block-start: var(--space-3);
  }
  .chip {
    font-size: var(--fs-sm);
    padding: var(--space-1) var(--space-3);
    border-radius: var(--r-full);
    background: var(--surface-2);
    border-color: var(--line);
    color: var(--muted);
  }
  .chip:hover {
    /* 카드 위에 얹히는 요소라 불투명 색이 아니라 막을 쓴다 — 표면 단계가 달라져도
       대비가 일정하다. (--panel-hover 는 칸반 드롭 전용이므로 여기 쓰지 않는다.) */
    background: var(--overlay-hover);
    border-color: var(--line-strong);
    color: var(--fg);
  }
  .error {
    display: flex;
    align-items: flex-start;
    gap: var(--space-2);
    color: var(--danger);
    font-size: var(--fs-sm);
    background: var(--danger-bg);
    padding: var(--space-2);
    border-radius: var(--r-sm);
    margin: 0;
  }

  footer {
    padding: var(--space-3);
  }
  .composer {
    display: flex;
    align-items: flex-end;
    gap: var(--space-2);
    padding: var(--space-2);
    background: var(--surface-3);
    border: 1px solid var(--line);
    border-radius: var(--r-md);
    transition:
      border-color var(--dur) var(--ease),
      box-shadow var(--dur) var(--ease);
  }
  .composer.focused {
    border-color: var(--accent-strong);
    box-shadow: var(--shadow-focus);
  }
  textarea {
    flex: 1;
    min-width: 0;
    resize: none;
    background: transparent;
    color: var(--fg);
    border: none;
    padding: 0;
    font: inherit;
    font-size: var(--fs-md);
    line-height: 1.5;
  }
  /* 포커스 링은 .composer 틀이 담당한다. 안쪽 textarea 에도 걸리면 링이 두 겹 생긴다. */
  textarea:focus,
  textarea:focus-visible {
    outline: none;
  }
  textarea::placeholder {
    color: var(--muted);
  }
  .submit {
    flex: none;
    width: 30px;
    height: 30px;
    padding: 0;
    justify-content: center;
    border-radius: var(--r-sm);
  }

  .usage {
    display: flex;
    gap: var(--space-3);
    padding: var(--space-1) var(--space-3);
    font-size: var(--fs-xs);
    color: var(--muted);
    border-top: 1px solid var(--line);
    transition: opacity var(--dur) var(--ease);
  }
  .usage.stale {
    opacity: 0.45;
  }
</style>
