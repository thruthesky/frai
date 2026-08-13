<script lang="ts">
  import { store, type Session } from './sessions.svelte'

  let { session }: { session: Session } = $props()

  let input = $state('')
  let scroller = $state<HTMLDivElement | null>(null)

  const provider = $derived(store.provider(session.providerId))
  const canRemove = $derived(store.sessions.length > 1)

  // 새 내용이 붙으면 아래로 따라간다. 사용자가 위로 올려 읽는 중이면 방해하지 않는다.
  $effect(() => {
    const lastLength = session.messages[session.messages.length - 1]?.content.length
    void lastLength
    if (!scroller) return
    const nearBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 120
    if (nearBottom) scroller.scrollTop = scroller.scrollHeight
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

  <div class="messages" bind:this={scroller}>
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
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 10px;
    overflow: hidden;
  }
  .card.busy {
    border-color: var(--accent);
  }

  header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 10px;
    border-bottom: 1px solid var(--line);
    background: var(--panel-head);
  }
  .spacer {
    flex: 1;
  }

  select {
    background: var(--input);
    color: var(--fg);
    border: 1px solid var(--line);
    border-radius: 6px;
    padding: 4px 6px;
    font-size: 12px;
    max-width: 160px;
  }

  .tag {
    font-size: 11px;
    padding: 2px 6px;
    border-radius: 999px;
    white-space: nowrap;
  }
  .tag.warn {
    background: color-mix(in srgb, var(--warn) 22%, transparent);
    color: var(--warn);
  }
  .tag.ok {
    background: color-mix(in srgb, var(--ok) 20%, transparent);
    color: var(--ok);
  }

  .notice {
    margin: 0;
    padding: 6px 10px;
    font-size: 11px;
    color: var(--muted);
    background: var(--panel-head);
    border-bottom: 1px solid var(--line);
  }

  .messages {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 10px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .msg .who {
    display: block;
    font-size: 11px;
    color: var(--muted);
    margin-bottom: 3px;
  }
  .msg .body {
    white-space: pre-wrap;
    word-break: break-word;
    font-size: 13px;
    line-height: 1.55;
  }
  .msg.user .body {
    background: var(--input);
    padding: 7px 9px;
    border-radius: 8px;
  }

  .caret {
    display: inline-block;
    width: 7px;
    height: 13px;
    margin-left: 2px;
    background: var(--accent);
    vertical-align: text-bottom;
    animation: blink 1s steps(2, start) infinite;
  }
  @keyframes blink {
    to {
      visibility: hidden;
    }
  }

  .empty {
    color: var(--muted);
    font-size: 12px;
    margin: auto;
    text-align: center;
  }
  .error {
    color: var(--danger);
    font-size: 12px;
    background: color-mix(in srgb, var(--danger) 12%, transparent);
    padding: 8px;
    border-radius: 6px;
    margin: 0;
  }

  footer {
    display: flex;
    gap: 6px;
    padding: 8px;
    border-top: 1px solid var(--line);
  }
  textarea {
    flex: 1;
    resize: none;
    background: var(--input);
    color: var(--fg);
    border: 1px solid var(--line);
    border-radius: 6px;
    padding: 6px 8px;
    font: inherit;
    font-size: 13px;
  }

  .usage {
    display: flex;
    gap: 10px;
    padding: 5px 10px;
    font-size: 11px;
    color: var(--muted);
    border-top: 1px solid var(--line);
  }
</style>
