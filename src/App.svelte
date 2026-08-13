<script lang="ts">
  import KanbanBoard from './lib/KanbanBoard.svelte'
  import SessionCard from './lib/SessionCard.svelte'
  import Icon from './lib/ui/Icon.svelte'
  import Segmented from './lib/ui/Segmented.svelte'
  import { store } from './lib/sessions.svelte'

  /** 그리드 열 수. 값이 넷뿐이라 슬라이더가 아니라 세그먼티드가 맞다. */
  const COLUMN_OPTIONS = [
    { value: 1, label: '1' },
    { value: 2, label: '2' },
    { value: 3, label: '3' },
    { value: 4, label: '4' },
  ]

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
      <div class="cols">
        <span>열</span>
        <Segmented
          value={store.columns}
          options={COLUMN_OPTIONS}
          ariaLabel="그리드 열 수"
          onchange={(value) => (store.columns = value)}
        />
      </div>

      <button onclick={() => store.add()}>
        <Icon name="plus" size={14} />
        세션 추가
      </button>

      <span class="spacer"></span>

      <div class="broadcast">
        <input
          bind:value={broadcast}
          onkeydown={onKeydown}
          placeholder={`선택한 ${selectedCount}개 세션에 같은 질문 보내기`}
          disabled={selectedCount === 0}
        />
        <button onclick={sendAll} disabled={!broadcast.trim() || selectedCount === 0}>
          <Icon name="send" size={14} />
          전체 전송
        </button>
      </div>
    {:else}
      <span class="hint">카드를 끌어서 칸 사이로 옮길 수 있습니다. 칸 이름을 누르면 이름을 바꿉니다.</span>
      <span class="spacer"></span>
      <button onclick={() => store.addColumn()}>
        <Icon name="plus" size={14} />
        칸 추가
      </button>
    {/if}
  </div>

  {#if !store.ready}
    <p class="loading">프로바이더를 확인하는 중…</p>
  {:else if store.view === 'grid'}
    <div class="grid" data-cols={store.columns}>
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
    height: var(--titlebar-h);
    display: flex;
    align-items: center;
    gap: var(--space-3);
    /* 왼쪽 신호등 버튼과 겹치지 않도록 비워 둔다. */
    padding-inline-start: 84px;
    padding-inline-end: var(--space-3);
    background: var(--surface-2);
    user-select: none;
  }
  .brand {
    font-weight: var(--fw-bold);
    letter-spacing: 0.04em;
  }
  .tagline {
    font-size: var(--fs-sm);
    color: var(--muted);
  }

  .viewswitch {
    display: flex;
    gap: 2px;
    background: var(--surface-3);
    border-radius: var(--r-sm);
    padding: 2px;
  }
  .viewswitch button {
    border: none;
    background: transparent;
    font-size: var(--fs-sm);
    padding: var(--space-1) var(--space-3);
    border-radius: var(--r-sm);
  }
  .viewswitch button:hover:not(:disabled) {
    background: var(--surface-2);
  }
  .viewswitch button.on {
    background: var(--surface-1);
    color: var(--accent);
    font-weight: var(--fw-medium);
    box-shadow: var(--shadow-1);
  }

  .account {
    font-size: var(--fs-sm);
    max-width: 220px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .authbar {
    margin: 0;
    padding: var(--space-2) var(--space-3);
    font-size: var(--fs-sm);
    color: var(--muted);
    background: var(--surface-2);
  }
  .authbar.error {
    color: var(--danger);
    background: var(--danger-bg);
  }

  /* 높이를 계산하지 않는다 — #app 이 세로 flex 라 남은 공간을 그대로 받는다.
     인증 안내가 떠도 하단 상태바가 잘리지 않는다. */
  main {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
  }

  /* 타이틀바와 같은 배경을 쓰고 사이 경계선을 두지 않는다. 두 줄이 하나의 크롬으로
     읽히게 하려는 것이며, 물리적으로 한 줄로 합치지는 않는다 — 타이틀바를 컨트롤로
     채우면 data-tauri-drag-region 이 사라져 창을 움직일 수 없게 된다. */
  .toolbar {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-2) var(--space-3);
    background: var(--surface-2);
    border-bottom: 1px solid var(--line);
  }
  .spacer {
    flex: 1;
  }
  .cols {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--fs-sm);
    color: var(--muted);
  }
  .hint {
    font-size: var(--fs-sm);
    color: var(--muted);
  }

  .broadcast {
    display: flex;
    gap: var(--space-2);
    flex: 1;
    max-width: 560px;
  }
  .broadcast input {
    flex: 1;
    background: var(--surface-3);
    color: var(--fg);
    border: 1px solid var(--line);
    border-radius: var(--r-sm);
    padding: var(--space-2) var(--space-3);
    font: inherit;
    font-size: var(--fs-md);
    transition: border-color var(--dur) var(--ease);
  }
  .broadcast input:focus-visible {
    border-color: var(--accent);
  }

  /* ⚠️ minmax(0, 1fr) 을 1fr 로 줄이지 말 것. 그리드 아이템의 기본 min-width:auto 가
     살아나면 카드 안의 nowrap 요소(배지)가 열 너비를 밀어낸다. */
  .grid {
    flex: 1;
    min-height: 0;
    display: grid;
    gap: var(--space-3);
    padding: var(--space-3);
    overflow-y: auto;
  }
  .grid[data-cols='1'] {
    grid-template-columns: minmax(0, 1fr);
  }
  .grid[data-cols='2'] {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .grid[data-cols='3'] {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
  .grid[data-cols='4'] {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }

  /* 열이 늘수록 카드가 좁아진다 — 창 최소 폭 800px 에서 4열이면 카드가 190px 안팎이라
     헤더(토글 + 프로바이더 + 배지 + 닫기)만으로 이미 빠듯하다. 좁은 열에서는 배지와
     제목의 글자를 지우고 아이콘만 남긴다. 의미는 aria-label·title 이 계속 전달한다.
     :global 이 필요한 이유는 이 요소들이 자식 컴포넌트(SessionCard) 안에 있어서다. */
  .grid[data-cols='3'] :global(.tag-label),
  .grid[data-cols='4'] :global(.tag-label),
  .grid[data-cols='4'] :global(.session-title),
  .grid[data-cols='4'] :global(header .btn-label) {
    display: none;
  }

  .loading {
    margin: auto;
    color: var(--muted);
  }

  .statusbar {
    display: flex;
    gap: var(--space-2);
    padding: var(--space-1) var(--space-3);
    font-size: var(--fs-xs);
    color: var(--muted);
    border-top: 1px solid var(--line);
    background: var(--surface-2);
  }
  .live {
    color: var(--accent);
  }

  /* 좁은 창에서는 마케팅 문구를 숨긴다 — 앱 크롬에 카피가 있는 것 자체가
     "웹사이트" 신호이고, 800px 에서는 자리도 없다. */
  @media (max-width: 1100px) {
    .tagline {
      display: none;
    }
  }
</style>
