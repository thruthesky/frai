<script lang="ts">
  import { store, type Column, type Session } from './sessions.svelte'

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
          <button class="ghost" onclick={() => store.removeColumn(col.id)} title="칸 삭제 (세션은 Backlog 로 이동)">
            ✕
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
        }}>+ 세션</button>
      </footer>
    </section>
  {/each}

  <button class="add-column" onclick={() => store.addColumn()}>+ 칸 추가</button>
</div>

<style>
  .board {
    flex: 1;
    min-height: 0;
    display: flex;
    gap: 10px;
    padding: 10px;
    overflow-x: auto;
    align-items: flex-start;
  }

  .column {
    display: flex;
    flex-direction: column;
    min-width: 280px;
    max-width: 280px;
    max-height: 100%;
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 10px;
    overflow: hidden;
  }
  .column.hover {
    border-color: var(--accent);
    background: color-mix(in srgb, var(--accent) 7%, var(--panel));
  }

  header {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 8px 10px;
    border-bottom: 1px solid var(--line);
    background: var(--panel-head);
  }
  .spacer {
    flex: 1;
  }
  .title {
    background: none;
    border: none;
    padding: 2px 4px;
    font-weight: 600;
    font-size: 13px;
    color: var(--fg);
    cursor: text;
  }
  .title:hover {
    background: var(--input);
    border-radius: 4px;
  }
  .rename {
    background: var(--input);
    color: var(--fg);
    border: 1px solid var(--accent);
    border-radius: 4px;
    padding: 2px 5px;
    font: inherit;
    font-size: 13px;
    font-weight: 600;
    width: 130px;
  }
  .count {
    font-size: 11px;
    color: var(--muted);
    background: var(--input);
    border-radius: 999px;
    padding: 1px 7px;
  }

  .cards {
    flex: 1;
    min-height: 60px;
    overflow-y: auto;
    padding: 8px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .card {
    background: var(--bg);
    border: 1px solid var(--line);
    border-radius: 8px;
    padding: 8px 9px;
    cursor: grab;
  }
  .card:hover {
    border-color: var(--accent);
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
    font-size: 13px;
    line-height: 1.4;
    word-break: break-word;
  }

  .meta {
    display: flex;
    align-items: center;
    gap: 4px;
    margin-top: 7px;
    flex-wrap: wrap;
  }
  .chip {
    font-size: 10px;
    padding: 1px 6px;
    border-radius: 999px;
    background: var(--input);
    color: var(--muted);
    white-space: nowrap;
  }
  .chip.warn {
    background: color-mix(in srgb, var(--warn) 22%, transparent);
    color: var(--warn);
  }
  .chip.ok {
    background: color-mix(in srgb, var(--ok) 20%, transparent);
    color: var(--ok);
  }
  .chip.live {
    background: color-mix(in srgb, var(--accent) 20%, transparent);
    color: var(--accent);
  }
  .chip.danger {
    background: color-mix(in srgb, var(--danger) 18%, transparent);
    color: var(--danger);
  }
  .count-msg {
    font-size: 10px;
    color: var(--muted);
  }

  .empty {
    margin: 0;
    padding: 14px 8px;
    text-align: center;
    font-size: 11px;
    color: var(--muted);
    border: 1px dashed var(--line);
    border-radius: 8px;
  }

  footer {
    padding: 6px 8px 8px;
  }
  .add {
    width: 100%;
    font-size: 12px;
  }

  .add-column {
    min-width: 130px;
    padding: 10px;
    border: 1px dashed var(--line);
    border-radius: 10px;
    background: transparent;
    color: var(--muted);
  }
  .add-column:hover {
    border-color: var(--accent);
    color: var(--accent);
  }
</style>
