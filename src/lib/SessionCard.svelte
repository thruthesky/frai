<script lang="ts">
  import { store, type Session } from './sessions.svelte'

  let { session }: { session: Session } = $props()

  let input = $state('')
  let scroller = $state<HTMLDivElement | null>(null)

  const provider = $derived(store.provider(session.providerId))
  const canRemove = $derived(store.sessions.length > 1)

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

<section class="card" class:busy={session.streaming}>
  <header>
    <input
      type="checkbox"
      bind:checked={session.selected}
      title="전체 전송 대상에 포함"
      aria-label="전체 전송 대상에 포함"
    />

    <select bind:value={session.providerId} disabled={session.streaming}>
      {#each store.providers as p (p.id)}
        <option value={p.id} disabled={!p.available}>
          {p.label}{p.available ? '' : ' (없음)'}
        </option>
      {/each}
    </select>

    {#if provider?.leavesDevice}
      <span class="tag warn" title="이 경로는 대화 내용이 getpes.com 서버를 지납니다.">
        서버 경유
      </span>
    {:else if provider?.kind === 'cli'}
      <span class="tag ok" title="로컬에서 실행됩니다. 추가 비용이 없습니다.">로컬</span>
    {/if}

    <span class="spacer"></span>

    {#if session.streaming}
      <button class="ghost" onclick={() => store.cancel(session)}>중단</button>
    {/if}
    {#if canRemove}
      <button class="ghost" onclick={() => store.remove(session)} title="세션 닫기">✕</button>
    {/if}
  </header>

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
      <p class="empty">질문을 입력하면 이 칸에서 대화가 시작됩니다.</p>
    {/if}

    {#if session.error}
      <p class="error">{session.error}</p>
    {/if}
  </div>

  <footer>
    <textarea
      bind:value={input}
      onkeydown={onKeydown}
      rows="2"
      placeholder="메시지 입력 (Enter 전송 · Shift+Enter 줄바꿈)"
      disabled={session.streaming}
    ></textarea>
    <button onclick={submit} disabled={session.streaming || !input.trim()}>보내기</button>
  </footer>

  {#if session.usage}
    <div class="usage">
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
    border-radius: var(--r-md);
    /* 테두리만으로 나누면 표처럼 보인다. 얕은 그림자가 카드를 배경에서 띄운다. */
    box-shadow: var(--shadow-1);
    /* ⚠️ 이 overflow 를 풀지 말 것. 헤더 배경과 메시지 스크롤 콘텐츠의 모서리
       클리핑을 이것 하나가 담당한다. 드롭다운 패널은 카드 밖으로 나가야 하므로
       잘리지 않게 position:fixed 로 띄운다(Select.svelte). */
    overflow: hidden;
    transition: border-color var(--dur) var(--ease);
  }
  .card.busy {
    border-color: var(--accent);
  }

  header {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    border-bottom: 1px solid var(--line);
    background: var(--surface-2);
  }
  .spacer {
    flex: 1;
  }

  select {
    background: var(--surface-3);
    color: var(--fg);
    border: 1px solid var(--line);
    border-radius: var(--r-sm);
    padding: var(--space-1) var(--space-2);
    font-size: var(--fs-sm);
    max-width: 160px;
  }

  .tag {
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
    color: var(--muted);
    margin-bottom: var(--space-1);
  }
  .msg .body {
    white-space: pre-wrap;
    word-break: break-word;
    font-size: var(--fs-md);
    line-height: 1.55;
  }
  .msg.user .body {
    background: var(--surface-3);
    padding: var(--space-2) var(--space-3);
    border-radius: var(--r-sm);
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

  .empty {
    color: var(--muted);
    font-size: var(--fs-sm);
    margin: auto;
    text-align: center;
  }
  .error {
    color: var(--danger);
    font-size: var(--fs-sm);
    background: var(--danger-bg);
    padding: var(--space-2);
    border-radius: var(--r-sm);
    margin: 0;
  }

  footer {
    display: flex;
    gap: var(--space-2);
    padding: var(--space-2);
    border-top: 1px solid var(--line);
  }
  textarea {
    flex: 1;
    resize: none;
    background: var(--surface-3);
    color: var(--fg);
    border: 1px solid var(--line);
    border-radius: var(--r-sm);
    padding: var(--space-2) var(--space-2);
    font: inherit;
    font-size: var(--fs-md);
    transition: border-color var(--dur) var(--ease);
  }
  textarea:focus-visible {
    border-color: var(--accent);
  }

  .usage {
    display: flex;
    gap: var(--space-3);
    padding: var(--space-1) var(--space-3);
    font-size: var(--fs-xs);
    color: var(--muted);
    border-top: 1px solid var(--line);
  }
</style>
