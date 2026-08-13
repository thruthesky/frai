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

  /**
   * 지금 각 칸에 **표시 중인** 비용의 합. 세션·기간 누적이 아니다 — 누적은 필드와
   * 저장소가 있어야 하므로 SQLite 도입(로드맵 6) 때 다룬다. 그래서 라벨도
   * "누적"이 아니라 "표시된 합"이라고 쓴다.
   *
   * remainingFree 는 더하지 않는다. 세션들이 공유하는 하나의 일일 쿼터라
   * 합산하면 남은 횟수가 세션 수만큼 부풀려진다.
   */
  const shownCost = $derived(
    store.sessions.reduce((sum, session) => sum + (session.usage?.costUsd ?? 0), 0),
  )

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
  <!-- 마크는 랜딩(getpes.com/frai)의 그라디언트와 같은 색이다. 받은 곳과 실행한
       앱이 같은 제품으로 읽히려면 이 색이 어긋나면 안 된다. -->
  <span class="mark" aria-hidden="true">F</span>
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
        <button
          class="primary"
          onclick={sendAll}
          disabled={!broadcast.trim() || selectedCount === 0}
        >
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
    {#if shownCost > 0}
      <span>·</span>
      <span>표시된 비용 합 ${shownCost.toFixed(4)}</span>
    {/if}
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
    gap: var(--space-2);
    /* 왼쪽 신호등 버튼과 겹치지 않도록 비워 둔다. */
    padding-inline-start: 84px;
    padding-inline-end: var(--space-3);
    background: var(--surface-2);
    border-bottom: 1px solid var(--line);
    user-select: none;
  }
  .mark {
    display: grid;
    place-items: center;
    width: 22px;
    height: 22px;
    border-radius: 6px;
    background: var(--brand-grad);
    color: #fff;
    font-size: var(--fs-sm);
    font-weight: var(--fw-bold);
    /* 그라디언트 위의 글자가 배경에 묻지 않게 한 겹 띄운다. */
    text-shadow: 0 1px 1px rgb(0 0 0 / 0.25);
  }
  .brand {
    font-weight: var(--fw-bold);
    letter-spacing: 0.04em;
    margin-inline-end: var(--space-1);
  }
  .tagline {
    font-size: var(--fs-sm);
    color: var(--muted);
  }

  .viewswitch {
    display: flex;
    gap: 2px;
    background: var(--surface-3);
    border-radius: var(--r-md);
    padding: 3px;
  }
  .viewswitch button {
    border: none;
    background: transparent;
    color: var(--muted);
    font-size: var(--fs-sm);
    padding: var(--space-1) var(--space-3);
    border-radius: 7px;
  }
  .viewswitch button:hover:not(:disabled) {
    background: var(--surface-2);
    color: var(--fg);
  }
  .viewswitch button.on {
    background: var(--surface-1);
    color: var(--fg);
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

  /* 한 번 입력해 여러 AI 에 동시에 보내는 것이 이 앱의 핵심 동작이다. 구석의
     보조 입력처럼 보이면 그 가치가 화면에 드러나지 않는다 — 툴바에서 가장 큰
     요소로 두고, 채워진 전송 버튼을 붙여 어디를 눌러야 하는지 분명히 한다. */
  .broadcast {
    display: flex;
    gap: var(--space-2);
    flex: 1;
    max-width: 720px;
  }
  .broadcast input {
    flex: 1;
    background: var(--surface-1);
    color: var(--fg);
    border: 1px solid var(--line);
    border-radius: var(--r-md);
    padding: 7px var(--space-3);
    font: inherit;
    font-size: var(--fs-md);
    transition:
      border-color var(--dur) var(--ease),
      box-shadow var(--dur) var(--ease);
  }
  .broadcast input::placeholder {
    color: var(--muted);
  }
  .broadcast input:focus {
    outline: none;
    border-color: var(--accent-strong);
    box-shadow: var(--shadow-focus);
  }

  /* ⚠️ minmax(0, 1fr) 을 1fr 로 줄이지 말 것. 그리드 아이템의 기본 min-width:auto 가
     살아나면 카드 안의 nowrap 요소(배지)가 열 너비를 밀어낸다. */
  .grid {
    flex: 1;
    min-height: 0;
    display: grid;
    /* 카드 네 장이 12px 간격이면 서로 붙어 한 덩어리로 보인다. 칸이 각각 독립된
       대화라는 것이 간격으로 읽혀야 한다. */
    gap: var(--space-4);
    padding: var(--space-4);
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
