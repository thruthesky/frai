<script lang="ts">
  import { store, type Column, type Session } from './sessions.svelte'
  import Icon from './ui/Icon.svelte'

  /** 지금 끌고 있는 세션. 드롭 대상 강조와 이동에 쓴다. */
  let dragging = $state<Session | null>(null)
  let hoverColumn = $state<string | null>(null)
  let editing = $state<string | null>(null)

  function onDragStart(e: DragEvent, session: Session) {
    dragging = session
    // 데이터도 넣어 둔다. 일부 환경은 dataTransfer 가 비면 드롭을 거부한다.
    e.dataTransfer?.setData('text/plain', session.id)
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'
  }

  function onDragOver(e: DragEvent, columnId: string) {
    if (!dragging) return
    e.preventDefault() // 기본값은 "드롭 금지" 이므로 반드시 막아야 한다.
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
    hoverColumn = columnId
  }

  function onDrop(e: DragEvent, columnId: string) {
    e.preventDefault()
    if (dragging) store.move(dragging, columnId)
    dragging = null
    hoverColumn = null
  }

  function finishRename(col: Column, value: string) {
    const title = value.trim()
    if (title) store.renameColumn(col.id, title)
    editing = null
  }

  function openInGrid(session: Session) {
    // 보드에서 카드를 누르면 그 세션만 남기지 않고, 그리드로 돌아가 전체를 보여준다.
    session.selected = true
    store.view = 'grid'
  }
</script>

<div class="board">
  {#each store.board as col (col.id)}
    {@const items = store.sessionsIn(col.id)}
    <section
      class="column"
      class:hover={hoverColumn === col.id}
      role="list"
      ondragover={(e) => onDragOver(e, col.id)}
      ondragleave={() => (hoverColumn = null)}
      ondrop={(e) => onDrop(e, col.id)}
    >
      <header>
        {#if editing === col.id}
          <!-- svelte-ignore a11y_autofocus -->
          <input
            class="rename"
            value={col.title}
            autofocus
            onblur={(e) => finishRename(col, e.currentTarget.value)}
            onkeydown={(e) => {
              if (e.key === 'Enter') finishRename(col, e.currentTarget.value)
              if (e.key === 'Escape') editing = null
            }}
          />
        {:else}
          <button class="title" onclick={() => (editing = col.id)} title="이름 바꾸기">
            {col.title}
          </button>
        {/if}

        <span class="count">{items.length}</span>
        <span class="spacer"></span>

        {#if !col.fixed}
          <!-- 아이콘만 있는 버튼이므로 aria-label 이 반드시 필요하다. title 은 일부
               스크린리더가 읽지 않아 이름 역할을 대신하지 못한다. -->
          <button
            class="ghost"
            onclick={() => store.removeColumn(col.id)}
            title="칸 삭제 (세션은 Backlog 로 이동)"
            aria-label="{col.title} 칸 삭제. 안에 있던 세션은 Backlog 로 이동합니다"
          >
            <Icon name="x" />
          </button>
        {/if}
      </header>

      <div class="cards">
        {#each items as session (session.id)}
          {@const provider = store.provider(session.providerId)}
          <article
            class="card"
            class:dragging={dragging === session}
            draggable="true"
            ondragstart={(e) => onDragStart(e, session)}
            ondragend={() => {
              dragging = null
              hoverColumn = null
            }}
          >
            <button class="card-open" onclick={() => openInGrid(session)}>
              <span class="card-title">{session.displayTitle}</span>
            </button>

            <div class="meta">
              <span class="chip">{provider?.label ?? session.providerId}</span>
              {#if provider?.leavesDevice}
                <span class="chip warn">서버 경유</span>
              {:else if provider?.kind === 'cli'}
                <span class="chip ok">로컬</span>
              {/if}
              {#if session.streaming}
                <span class="chip live">응답 중</span>
              {:else if session.error}
                <span class="chip danger">오류</span>
              {/if}
              <span class="spacer"></span>
              <span class="count-msg">{session.messages.length}개 메시지</span>
            </div>
          </article>
        {/each}

        {#if items.length === 0}
          <p class="empty">{col.fixed ? '새 세션은 여기로 들어옵니다.' : '카드를 끌어다 놓으세요.'}</p>
        {/if}
      </div>

      <footer>
        <button class="ghost add" onclick={() => {
          store.add()
          const created = store.sessions[store.sessions.length - 1]
          created.columnId = col.id
        }}>
          <Icon name="plus" size={14} />
          세션
        </button>
      </footer>
    </section>
  {/each}

  <button class="add-column" onclick={() => store.addColumn()}>
    <Icon name="plus" size={14} />
    칸 추가
  </button>
</div>

<style>
  .board {
    flex: 1;
    min-height: 0;
    display: flex;
    gap: var(--space-3);
    padding: var(--space-3);
    overflow-x: auto;
    align-items: flex-start;
  }

  .column {
    display: flex;
    flex-direction: column;
    min-width: 280px;
    max-width: 280px;
    max-height: 100%;
    background: var(--surface-1);
    border: 1px solid var(--line);
    border-radius: var(--r-md);
    box-shadow: var(--shadow-1);
    overflow: hidden;
    transition:
      border-color var(--dur) var(--ease),
      background-color var(--dur) var(--ease);
  }
  .column.hover {
    border-color: var(--accent);
    /* 알파가 아니라 불투명 색이다 — 원래 값이 accent 를 카드 배경과 섞은 것이라
       투명도로 바꾸면 뒤 배경이 비쳐 다른 색이 된다. */
    background: var(--panel-hover);
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
  .title {
    background: none;
    border: none;
    padding: 2px var(--space-1);
    font-weight: var(--fw-bold);
    font-size: var(--fs-md);
    color: var(--fg);
    cursor: text;
  }
  .title:hover {
    background: var(--surface-3);
    border-radius: var(--r-sm);
  }
  .rename {
    background: var(--surface-3);
    color: var(--fg);
    border: 1px solid var(--accent);
    border-radius: var(--r-sm);
    padding: 2px var(--space-1);
    font: inherit;
    font-size: var(--fs-md);
    font-weight: var(--fw-bold);
    width: 130px;
  }
  .count {
    font-size: var(--fs-xs);
    color: var(--muted);
    background: var(--surface-3);
    border-radius: var(--r-full);
    padding: 1px var(--space-2);
  }

  .cards {
    flex: 1;
    min-height: 60px;
    overflow-y: auto;
    padding: var(--space-2);
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .card {
    background: var(--bg);
    border: 1px solid var(--line);
    border-radius: var(--r-sm);
    padding: var(--space-2);
    cursor: grab;
    transition:
      border-color var(--dur) var(--ease),
      box-shadow var(--dur) var(--ease);
  }
  .card:hover {
    border-color: var(--line-strong);
    box-shadow: var(--shadow-1);
  }
  .card:active {
    cursor: grabbing;
  }
  .card.dragging {
    opacity: 0.45;
  }

  .card-open {
    display: block;
    width: 100%;
    text-align: start;
    background: none;
    border: none;
    padding: 0;
    color: var(--fg);
    cursor: pointer;
  }
  .card-title {
    font-size: var(--fs-md);
    line-height: 1.4;
    word-break: break-word;
  }

  .meta {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    margin-top: var(--space-2);
    flex-wrap: wrap;
  }
  .chip {
    font-size: var(--fs-xs);
    padding: 1px var(--space-2);
    border-radius: var(--r-full);
    background: var(--surface-3);
    color: var(--muted);
    white-space: nowrap;
  }
  .chip.warn {
    background: var(--warn-bg);
    color: var(--warn);
  }
  .chip.ok {
    background: var(--ok-bg);
    color: var(--ok);
  }
  .chip.live {
    background: var(--accent-bg);
    color: var(--accent);
  }
  .chip.danger {
    background: var(--danger-bg);
    color: var(--danger);
  }
  .count-msg {
    font-size: var(--fs-xs);
    color: var(--muted);
  }

  .empty {
    margin: 0;
    padding: var(--space-4) var(--space-2);
    text-align: center;
    font-size: var(--fs-xs);
    color: var(--muted);
    border: 1px dashed var(--line);
    border-radius: var(--r-sm);
  }

  footer {
    padding: var(--space-2);
  }
  .add {
    width: 100%;
    justify-content: center;
    font-size: var(--fs-sm);
  }

  .add-column {
    min-width: 130px;
    justify-content: center;
    padding: var(--space-3);
    border: 1px dashed var(--line);
    border-radius: var(--r-md);
    background: transparent;
    color: var(--muted);
  }
  .add-column:hover {
    border-color: var(--accent);
    color: var(--accent);
    background: transparent;
  }
</style>
