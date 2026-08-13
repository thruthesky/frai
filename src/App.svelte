<script lang="ts">
  import KanbanBoard from './lib/KanbanBoard.svelte'
  import SessionCard from './lib/SessionCard.svelte'
  import { store } from './lib/sessions.svelte'

  let broadcast = $state('')

  const selectedCount = $derived(store.sessions.filter((s) => s.selected).length)
  const anyStreaming = $derived(store.sessions.some((s) => s.streaming))

  $effect(() => {
    void store.init()
  })

  function sendAll() {
    const text = broadcast
    broadcast = ''
    void store.broadcast(text)
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault()
      sendAll()
    }
  }
</script>

<!-- 타이틀바를 투명 처리했으므로 신호등 버튼 자리를 비워 두고 이 영역을 드래그 핸들로 쓴다. -->
<div class="titlebar" data-tauri-drag-region>
  <span class="brand">FRAI</span>
  <span class="tagline">여러 인공지능을 한 화면에서</span>

  <span class="spacer"></span>

  <div class="viewswitch">
    <button class:on={store.view === 'grid'} onclick={() => (store.view = 'grid')}>바둑판</button>
    <button class:on={store.view === 'board'} onclick={() => (store.view = 'board')}>세션 목록</button>
  </div>

  <!-- 익명으로도 앱은 전부 동작한다. 로그인은 동기화와 무료 한도 확대를 위한 부가 기능이다. -->
  {#if store.auth.signedIn}
    <button class="account" onclick={() => store.signOut()} disabled={store.authBusy}>
      {store.auth.displayName ?? '로그인됨'} · 로그아웃
    </button>
  {:else}
    <button class="account" onclick={() => store.signIn()} disabled={store.authBusy}>
      {store.authBusy ? '브라우저에서 로그인 중…' : 'getpes.com 로그인'}
    </button>
  {/if}
</div>

{#if store.authError}
  <p class="authbar error">{store.authError}</p>
{:else if store.authBusy}
  <p class="authbar">브라우저에서 로그인을 마치면 자동으로 돌아옵니다.</p>
{/if}

<main>
  <div class="toolbar">
    {#if store.view === 'grid'}
      <label class="cols">
        열
        <input type="range" min="1" max="4" bind:value={store.columns} />
        <span>{store.columns}</span>
      </label>

      <button onclick={() => store.add()}>+ 세션 추가</button>

      <span class="spacer"></span>

      <div class="broadcast">
        <input
          bind:value={broadcast}
          onkeydown={onKeydown}
          placeholder={`선택한 ${selectedCount}개 세션에 같은 질문 보내기`}
          disabled={selectedCount === 0}
        />
        <button onclick={sendAll} disabled={!broadcast.trim() || selectedCount === 0}>
          전체 전송
        </button>
      </div>
    {:else}
      <span class="hint">카드를 끌어서 칸 사이로 옮길 수 있습니다. 칸 이름을 누르면 이름을 바꿉니다.</span>
      <span class="spacer"></span>
      <button onclick={() => store.addColumn()}>+ 칸 추가</button>
    {/if}
  </div>

  {#if !store.ready}
    <p class="loading">프로바이더를 확인하는 중…</p>
  {:else if store.view === 'grid'}
    <div class="grid" style="--cols: {store.columns}">
      {#each store.sessions as session (session.id)}
        <SessionCard {session} />
      {/each}
    </div>
  {:else}
    <KanbanBoard />
  {/if}

  <div class="statusbar">
    <span>{store.sessions.length}개 세션</span>
    <span>·</span>
    <span>{selectedCount}개 선택됨</span>
    {#if anyStreaming}
      <span>·</span>
      <span class="live">응답 받는 중…</span>
    {/if}
  </div>
</main>

<style>
  .titlebar {
    height: 38px;
    display: flex;
    align-items: center;
    gap: 10px;
    /* 왼쪽 신호등 버튼과 겹치지 않도록 비워 둔다. */
    padding-inline-start: 84px;
    padding-inline-end: 10px;
    border-bottom: 1px solid var(--line);
    background: var(--panel-head);
    user-select: none;
  }
  .brand {
    font-weight: 700;
    letter-spacing: 0.04em;
  }
  .tagline {
    font-size: 12px;
    color: var(--muted);
  }

  .viewswitch {
    display: flex;
    gap: 2px;
    background: var(--input);
    border-radius: 7px;
    padding: 2px;
  }
  .viewswitch button {
    border: none;
    background: transparent;
    font-size: 12px;
    padding: 4px 10px;
    border-radius: 5px;
  }
  .viewswitch button.on {
    background: var(--panel);
    color: var(--accent);
  }

  .account {
    font-size: 12px;
    max-width: 220px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .authbar {
    margin: 0;
    padding: 6px 12px;
    font-size: 12px;
    color: var(--muted);
    background: var(--panel-head);
    border-bottom: 1px solid var(--line);
  }
  .authbar.error {
    color: var(--danger);
    background: color-mix(in srgb, var(--danger) 10%, transparent);
  }

  main {
    display: flex;
    flex-direction: column;
    height: calc(100vh - 38px);
    min-height: 0;
  }

  .toolbar {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 12px;
    border-bottom: 1px solid var(--line);
  }
  .spacer {
    flex: 1;
  }
  .cols {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    color: var(--muted);
  }
  .cols input {
    width: 90px;
  }
  .hint {
    font-size: 12px;
    color: var(--muted);
  }

  .broadcast {
    display: flex;
    gap: 6px;
    flex: 1;
    max-width: 560px;
  }
  .broadcast input {
    flex: 1;
    background: var(--input);
    color: var(--fg);
    border: 1px solid var(--line);
    border-radius: 6px;
    padding: 6px 9px;
    font: inherit;
    font-size: 13px;
  }

  .grid {
    flex: 1;
    min-height: 0;
    display: grid;
    grid-template-columns: repeat(var(--cols), minmax(0, 1fr));
    gap: 10px;
    padding: 10px;
    overflow-y: auto;
  }

  .loading {
    margin: auto;
    color: var(--muted);
  }

  .statusbar {
    display: flex;
    gap: 6px;
    padding: 5px 12px;
    font-size: 11px;
    color: var(--muted);
    border-top: 1px solid var(--line);
  }
  .live {
    color: var(--accent);
  }
</style>
