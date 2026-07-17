import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Router } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BoardStore } from './board.store';
import { BoardTransport } from './board-transport';
import { COLLABORATIF_API_URL, COLLABORATIF_CURRENT_USER } from './config/tokens';
import type { BoardField, BoardVote, Card, Connection, Frame, VoteSession } from '../../whiteboard/model/board.types';

const TEST_API_URL = 'http://localhost:8083/api/collaboratif';
const BOARD_ID = 'board-1';

/**
 * Test double for {@link BoardTransport} — records `emit()` calls and lets tests dispatch
 * inbound broadcasts synchronously via {@link FakeTransport.dispatch}, with a controllable
 * {@link FakeTransport.getSessionId} for the fix/EN08.4 sender-exclusion tests below.
 */
class FakeTransport extends BoardTransport {
  readonly emitted: { type: string; data: unknown; guaranteed?: boolean }[] = [];
  private sessionId = 'my-session-id';
  private connected = true;
  private readonly handlers = new Map<string, Set<(data: unknown) => void>>();

  connect(): void {}
  disconnect(): void {}

  emit(type: string, data: unknown, opts?: { guaranteed?: boolean }): void {
    this.emitted.push({ type, data, guaranteed: opts?.guaranteed });
  }

  override isConnected(): boolean {
    return this.connected;
  }

  setConnected(value: boolean): void {
    this.connected = value;
  }

  on<T = unknown>(type: string, handler: (data: T) => void): () => void {
    const set = this.handlers.get(type) ?? new Set<(data: unknown) => void>();
    set.add(handler as (data: unknown) => void);
    this.handlers.set(type, set);
    return () => set.delete(handler as (data: unknown) => void);
  }

  onReconnect(): () => void {
    return () => {};
  }

  getSessionId(): string {
    return this.sessionId;
  }

  setSessionId(id: string): void {
    this.sessionId = id;
  }

  /** Fires every handler registered for `type`, simulating an inbound broadcast. */
  dispatch<T>(type: string, data: T): void {
    this.handlers.get(type)?.forEach((h) => h(data));
  }
}

function baseCard(overrides: Partial<Card> = {}): Card {
  return {
    id: 'card-1',
    boardId: BOARD_ID,
    type: 'TEXT',
    content: 'hi',
    meta: null,
    posX: 0,
    posY: 0,
    width: 192,
    height: 128,
    color: '#FFEB3B',
    groupId: null,
    groupColor: null,
    locked: false,
    layer: 1,
    fieldValues: [],
    ...overrides,
  };
}

describe('BoardStore — card:moved/card:resized sender exclusion (fix/EN08.4)', () => {
  let store: BoardStore;
  let transport: FakeTransport;
  let httpMock: HttpTestingController;

  /** Flushes the four read-only GETs that `BoardStore.init()` fires. */
  async function flushInitRequests(): Promise<void> {
    httpMock.expectOne((r) => r.url === `${TEST_API_URL}/whiteboard/boards/${BOARD_ID}`).flush({
      id: BOARD_ID,
      title: 'Board',
      description: null,
      coverImage: null,
      maxParticipants: null,
      enabledActivities: [],
      role: 'OWNER',
    });
    httpMock.expectOne((r) => r.url === `${TEST_API_URL}/whiteboard/boards/${BOARD_ID}/members`).flush([]);
    httpMock
      .expectOne((r) => r.url === `${TEST_API_URL}/whiteboard/boards/${BOARD_ID}/vote/current`)
      .flush('', { status: 404, statusText: 'Not Found' });
    httpMock
      .expectOne((r) => r.url === `${TEST_API_URL}/whiteboard/boards/${BOARD_ID}/vote/last`)
      .flush('', { status: 404, statusText: 'Not Found' });
    // loadBoard()/loadMembers()/loadVote() await firstValueFrom() — flush() resolves the
    // observable synchronously but the continuation runs a microtask later.
    await Promise.resolve();
    await Promise.resolve();
  }

  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [
        BoardStore,
        { provide: BoardTransport, useClass: FakeTransport },
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: Router, useValue: { navigateByUrl: vi.fn().mockResolvedValue(true) } },
        { provide: COLLABORATIF_API_URL, useValue: TEST_API_URL },
      ],
    });
    store = TestBed.inject(BoardStore);
    transport = TestBed.inject(BoardTransport) as unknown as FakeTransport;
    httpMock = TestBed.inject(HttpTestingController);
    store.init(BOARD_ID);
    await flushInitRequests();
    store.cards.set([baseCard()]);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('ignores card:moved whose senderSessionId matches the transport\'s own session id', () => {
    transport.setSessionId('my-conn');
    transport.dispatch('card:moved', { ...baseCard(), posX: 999, posY: 999, senderSessionId: 'my-conn' });

    expect(store.cards()[0].posX).toBe(0);
    expect(store.cards()[0].posY).toBe(0);
  });

  it('applies card:moved whose senderSessionId is a different session', () => {
    transport.setSessionId('my-conn');
    transport.dispatch('card:moved', { ...baseCard(), posX: 42, posY: 84, senderSessionId: 'other-conn' });

    expect(store.cards()[0].posX).toBe(42);
    expect(store.cards()[0].posY).toBe(84);
  });

  it('applies card:moved carrying no senderSessionId at all', () => {
    transport.dispatch('card:moved', { ...baseCard(), posX: 10, posY: 20 });

    expect(store.cards()[0].posX).toBe(10);
    expect(store.cards()[0].posY).toBe(20);
  });

  it('renders a boardfield:created field once when its emitter-included echo replays (US08.10.1)', () => {
    const field: BoardField = {
      id: 'field-1',
      boardId: BOARD_ID,
      name: 'Priority',
      emoji: null,
      type: 'SELECT',
      options: ['Low', 'High'],
      order: 0,
    };
    // The `boardfield:created` broadcast is emitter-included, so the creating client receives its
    // own echo; a reconnect can replay it too. The handler must be idempotent — dispatching twice
    // must not duplicate the field (regression: a blind append rendered it twice).
    transport.dispatch('boardfield:created', field);
    transport.dispatch('boardfield:created', field);

    expect(store.fields().filter((f) => f.id === 'field-1')).toHaveLength(1);
  });

  it('renders a frame:created frame once when its emitter-included echo replays (US08.8.1)', () => {
    const frame = {
      id: 'frame-1',
      boardId: BOARD_ID,
      title: '',
      posX: 0,
      posY: 0,
      width: 400,
      height: 300,
      layer: 1,
    } as Frame;
    // Same emitter-included echo as `boardfield:created` (#134): the creating client receives its
    // own `frame:created`, and a reconnect can replay it after `board:state` already carried the
    // frame. Dispatching twice must not duplicate it (regression: a blind append rendered the
    // frame twice on the creator until reload).
    transport.dispatch('frame:created', frame);
    transport.dispatch('frame:created', frame);

    expect(store.frames().filter((f) => f.id === 'frame-1')).toHaveLength(1);
  });

  it('never leaks senderSessionId into the stored card state', () => {
    transport.dispatch('card:moved', { ...baseCard(), posX: 10, posY: 20, senderSessionId: 'other-conn' });

    expect(store.cards()[0]).not.toHaveProperty('senderSessionId');
  });

  it('ignores card:resized whose senderSessionId matches the transport\'s own session id', () => {
    transport.setSessionId('my-conn');
    transport.dispatch('card:resized', {
      ...baseCard(),
      width: 500,
      height: 500,
      senderSessionId: 'my-conn',
    });

    expect(store.cards()[0].width).toBe(192);
    expect(store.cards()[0].height).toBe(128);
  });

  it('applies card:resized whose senderSessionId is a different session', () => {
    transport.setSessionId('my-conn');
    transport.dispatch('card:resized', {
      ...baseCard(),
      width: 500,
      height: 400,
      senderSessionId: 'other-conn',
    });

    expect(store.cards()[0].width).toBe(500);
    expect(store.cards()[0].height).toBe(400);
  });

  it('applies card:resized carrying no senderSessionId at all', () => {
    transport.dispatch('card:resized', { ...baseCard(), width: 300, height: 250 });

    expect(store.cards()[0].width).toBe(300);
    expect(store.cards()[0].height).toBe(250);
  });

  // ── BUG 4: optimistic drag stays put, cards never vanish ────────────────────
  it('ignores a stale card:moved for a card being actively dragged (no snap-back mid-drag)', () => {
    store.startDragCard('card-1');
    store.moveCard('card-1', 300, 400);
    // A late, stale echo (an earlier throttled position round-tripping) arrives mid-drag.
    transport.dispatch('card:moved', { ...baseCard(), posX: 50, posY: 60 });

    expect(store.cards()[0].posX).toBe(300);
    expect(store.cards()[0].posY).toBe(400);
  });

  it('ignores a stale card:moved arriving right after drop (no revert to previous position)', () => {
    store.startDragCard('card-1');
    store.moveCard('card-1', 300, 400);
    store.commitDragCard();
    // The card:moved echo of the drag (or an older throttled one) lands just after release.
    transport.dispatch('card:moved', { ...baseCard(), posX: 0, posY: 0 });

    expect(store.cards()[0].posX).toBe(300);
    expect(store.cards()[0].posY).toBe(400);
  });

  it('honours a remote card:moved again once the post-drop grace window has elapsed', () => {
    vi.useFakeTimers();
    try {
      store.startDragCard('card-1');
      store.moveCard('card-1', 300, 400);
      store.commitDragCard();
      // Past LOCAL_CONTROL_GRACE_MS (2000 ms, sized to outlast a rate-limit reconnect — BUG J).
      vi.advanceTimersByTime(2100);
      transport.dispatch('card:moved', { ...baseCard(), posX: 12, posY: 34 });

      expect(store.cards()[0].posX).toBe(12);
      expect(store.cards()[0].posY).toBe(34);
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

  it('throttles a burst of card:move emits and sends only the latest position (BUG J)', () => {
    vi.useFakeTimers();
    try {
      const moves = () => transport.emitted.filter((e) => e.type === 'card:move');
      store.startDragCard('card-1');
      // A burst of rapid moves inside one throttle window — must coalesce, not flood the wire
      // (a per-frame emit here would exceed the backend's 30 SEND/s cap and force-close).
      store.moveCard('card-1', 10, 10);
      store.moveCard('card-1', 20, 20);
      store.moveCard('card-1', 30, 30);
      expect(moves()).toHaveLength(0); // nothing sent synchronously
      vi.advanceTimersByTime(0); // first emit is scheduled with zero delay
      expect(moves()).toHaveLength(1);
      expect(moves().at(-1)!.data).toEqual({ id: 'card-1', boardId: BOARD_ID, posX: 30, posY: 30 });

      // A second burst within the window is held until the throttle interval elapses.
      store.moveCard('card-1', 40, 40);
      store.moveCard('card-1', 50, 50);
      expect(moves()).toHaveLength(1);
      vi.advanceTimersByTime(50);
      expect(moves()).toHaveLength(2);
      expect(moves().at(-1)!.data).toEqual({ id: 'card-1', boardId: BOARD_ID, posX: 50, posY: 50 });
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

  it('flushes the final drop position immediately on commit, unthrottled (BUG J)', () => {
    vi.useFakeTimers();
    try {
      const moves = () => transport.emitted.filter((e) => e.type === 'card:move');
      store.startDragCard('card-1');
      store.moveCard('card-1', 10, 10);
      vi.advanceTimersByTime(0); // let the throttled intermediate emit go out
      store.moveCard('card-1', 999, 888); // held by the throttle window
      store.commitDragCard(); // must flush the final position synchronously, not wait
      expect(moves().at(-1)!.data).toEqual({ id: 'card-1', boardId: BOARD_ID, posX: 999, posY: 888 });
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

  it('coalesces a burst of resizeCardBox emits into one card:resize + one card:move per window (BUG J)', () => {
    vi.useFakeTimers();
    try {
      const of = (t: string) => transport.emitted.filter((e) => e.type === t);
      store.startResizeCard('card-1');
      store.resizeCardBox('card-1', { posX: 0, posY: 0, width: 200, height: 150 });
      store.resizeCardBox('card-1', { posX: 0, posY: 0, width: 260, height: 190 });
      expect(of('card:resize')).toHaveLength(0); // nothing sent synchronously
      vi.advanceTimersByTime(0); // first flush is scheduled with zero delay
      expect(of('card:resize')).toHaveLength(1);
      expect(of('card:move')).toHaveLength(1);
      expect(of('card:resize').at(-1)!.data).toMatchObject({ id: 'card-1', width: 260, height: 190 });
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

  it('flushes the final resize immediately on commit, unthrottled (BUG J)', () => {
    vi.useFakeTimers();
    try {
      const resizes = () => transport.emitted.filter((e) => e.type === 'card:resize');
      store.startResizeCard('card-1');
      store.resizeCardBox('card-1', { posX: 0, posY: 0, width: 999, height: 888 }); // held by the window
      store.commitResizeCard('card-1'); // must flush the final size synchronously, not wait
      expect(resizes().at(-1)!.data).toMatchObject({ id: 'card-1', width: 999, height: 888 });
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

  it('coalesces a frame drag (frame + captured cards) to one frame per entity per window (BUG J)', () => {
    vi.useFakeTimers();
    try {
      store.frames.set([
        { id: 'frame-1', boardId: BOARD_ID, title: 'F', posX: 0, posY: 0, width: 400, height: 300, color: '#fff', active: true, layer: 1 },
      ]);
      store.cards.set([baseCard({ id: 'card-1', posX: 10, posY: 10 })]);
      const captured = [{ id: 'card-1', startX: 10, startY: 10, frameStartX: 0, frameStartY: 0 }];
      store.startDragFrame('frame-1', ['card-1']);
      store.moveFrame('frame-1', 30, 30, captured);
      store.moveFrame('frame-1', 60, 60, captured);
      expect(transport.emitted.filter((e) => e.type === 'frame:move')).toHaveLength(0); // nothing synchronous
      vi.advanceTimersByTime(0);
      const frameMoves = transport.emitted.filter((e) => e.type === 'frame:move');
      const cardMoves = transport.emitted.filter((e) => e.type === 'card:move');
      expect(frameMoves).toHaveLength(1); // one frame:move for the whole burst, not one per pointermove
      expect(cardMoves).toHaveLength(1); // one card:move for the captured card, not one per pointermove
      expect(frameMoves.at(-1)!.data).toMatchObject({ id: 'frame-1', posX: 60, posY: 60 });
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

  it('keeps the final resize pending while disconnected, then delivers it guaranteed on commit (U3 regression)', () => {
    vi.useFakeTimers();
    try {
      transport.setConnected(false);
      const resizes = () => transport.emitted.filter((e) => e.type === 'card:resize');
      store.startResizeCard('card-1');
      store.resizeCardBox('card-1', { posX: 0, posY: 0, width: 300, height: 200 });
      vi.advanceTimersByTime(50); // throttled intermediate flush fires while disconnected...
      expect(resizes()).toHaveLength(0); // ...emits nothing and keeps the latest value pending
      store.commitResizeCard('card-1'); // commit flush delivers the terminal value, guaranteed
      const last = resizes().at(-1);
      expect(last!.data).toMatchObject({ id: 'card-1', width: 300, height: 200 });
      expect(last!.guaranteed).toBe(true);
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

  // ── Copy / paste / duplicate ────────────────────────────────────────────────
  it('copySelected copies the selected cards to the clipboard', () => {
    localStorage.clear();
    store.cards.set([baseCard({ id: 'card-1' }), baseCard({ id: 'card-2', posX: 300 })]);
    store.selectCards(new Set(['card-1']));

    expect(store.copySelected()).toBe(1);
    expect(store.canPaste()).toBe(true);
    expect(store.clipboard()).toHaveLength(1);
    expect(store.clipboard()[0]).toMatchObject({ type: 'TEXT', posX: 0, width: 192 });
  });

  it('copySelected returns 0 and does not arm paste when nothing is selected', () => {
    localStorage.clear();
    store.clipboard.set([]);
    store.selectCards(new Set());

    expect(store.copySelected()).toBe(0);
    expect(store.canPaste()).toBe(false);
  });

  it('pasteFromClipboard emits a card:create for each clipboard card', () => {
    store.selectCards(new Set(['card-1']));
    store.copySelected();
    const before = transport.emitted.filter((e) => e.type === 'card:create').length;

    store.pasteFromClipboard();

    expect(transport.emitted.filter((e) => e.type === 'card:create').length).toBe(before + 1);
  });

  it('pasteFromClipboard is a no-op when the clipboard and its mirror are empty', () => {
    localStorage.clear();
    store.clipboard.set([]);
    const before = transport.emitted.filter((e) => e.type === 'card:create').length;

    store.pasteFromClipboard();

    expect(transport.emitted.filter((e) => e.type === 'card:create').length).toBe(before);
  });

  it('duplicateSelected copies then pastes the selection (one card:create)', () => {
    store.selectCards(new Set(['card-1']));
    const before = transport.emitted.filter((e) => e.type === 'card:create').length;

    store.duplicateSelected();

    expect(transport.emitted.filter((e) => e.type === 'card:create').length).toBe(before + 1);
  });

  it('board:state keeps the local position of a card being actively dragged', () => {
    store.startDragCard('card-1');
    store.moveCard('card-1', 300, 400);
    // A room-wide board:state (another participant joined) carrying the pre-drag server position.
    transport.dispatch('board:state', {
      cards: [baseCard({ posX: 0, posY: 0 })],
      connections: [],
      frames: [],
      fields: [],
    });

    expect(store.cards()[0].posX).toBe(300);
    expect(store.cards()[0].posY).toBe(400);
  });

  it('board:state preserves an optimistic card still awaiting its card:created echo', () => {
    store.cards.set([]);
    store.addCard(0, 0, 'TEXT', 'draft');
    const provisional = store.cards().at(-1);
    expect(provisional).toBeDefined();

    // A room-wide board:state that predates our create must not wipe the provisional card.
    transport.dispatch('board:state', { cards: [], connections: [], frames: [], fields: [] });

    expect(store.cards().some((c) => c.id === provisional!.id)).toBe(true);
  });
});

/**
 * In-memory {@link BoardTransport} double — records every outbound `emit(type, data)` call
 * and lets a test simulate an inbound broadcast by directly invoking the handlers registered
 * via `on(type, handler)` (mirroring how `StompBoardTransport` demultiplexes a real STOMP
 * `{type, data}` envelope, without any actual WebSocket).
 */
class FakeBoardTransport extends BoardTransport {
  readonly emitted: Array<{ type: string; data: unknown }> = [];
  private readonly handlers = new Map<string, Set<(data: unknown) => void>>();

  connect(): void {}
  disconnect(): void {}

  emit(type: string, data: unknown): void {
    this.emitted.push({ type, data });
  }

  on<T = unknown>(type: string, handler: (data: T) => void): () => void {
    const set = this.handlers.get(type) ?? new Set();
    set.add(handler as (data: unknown) => void);
    this.handlers.set(type, set);
    return () => set.delete(handler as (data: unknown) => void);
  }

  private readonly reconnectHandlers = new Set<() => void>();

  onReconnect(handler: () => void): () => void {
    this.reconnectHandlers.add(handler);
    return () => this.reconnectHandlers.delete(handler);
  }

  getSessionId(): string {
    return 'fake-board-transport-session';
  }

  /** Simulates the server broadcasting `type` with `data` to every registered handler. */
  trigger<T>(type: string, data: T): void {
    this.handlers.get(type)?.forEach((h) => h(data));
  }

  /** Simulates an automatic reconnect, firing every registered re-join handler. */
  triggerReconnect(): void {
    this.reconnectHandlers.forEach((h) => h());
  }
}

function makeCard(id: string, overrides: Partial<Card> = {}): Card {
  return {
    id,
    boardId: BOARD_ID,
    type: 'TEXT',
    content: '',
    posX: 0,
    posY: 0,
    width: 192,
    height: 128,
    color: '#FFEB3B',
    groupId: null,
    groupColor: null,
    locked: false,
    layer: 1,
    fieldValues: [],
    ...overrides,
  };
}

function makeConnection(id: string, fromId: string, toId: string, overrides: Partial<Connection> = {}): Connection {
  return {
    id,
    boardId: BOARD_ID,
    fromId,
    toId,
    label: null,
    color: null,
    shape: 'curved',
    arrow: 'none',
    dashed: false,
    width: 2,
    ...overrides,
  };
}

describe('BoardStore — connections (US08.7.1)', () => {
  let httpMock: HttpTestingController;
  let transport: FakeBoardTransport;
  let store: BoardStore;

  /** Flushes the four read-only GETs that `init()` fires, same pattern as board-page's spec. */
  async function flushInitRequests(): Promise<void> {
    httpMock.expectOne((r) => r.url === `${TEST_API_URL}/whiteboard/boards/${BOARD_ID}`).flush({
      id: BOARD_ID,
      title: 'Board',
      role: 'OWNER',
      description: null,
      coverImage: null,
      maxParticipants: null,
      enabledActivities: [],
    });
    httpMock.expectOne((r) => r.url === `${TEST_API_URL}/whiteboard/boards/${BOARD_ID}/members`).flush([]);
    httpMock
      .expectOne((r) => r.url === `${TEST_API_URL}/whiteboard/boards/${BOARD_ID}/vote/current`)
      .flush('', { status: 404, statusText: 'Not Found' });
    httpMock
      .expectOne((r) => r.url === `${TEST_API_URL}/whiteboard/boards/${BOARD_ID}/vote/last`)
      .flush('', { status: 404, statusText: 'Not Found' });
    await Promise.resolve();
    await Promise.resolve();
  }

  beforeEach(() => {
    transport = new FakeBoardTransport();
    TestBed.configureTestingModule({
      providers: [
        BoardStore,
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: Router, useValue: { navigateByUrl: vi.fn().mockResolvedValue(true) } },
        { provide: COLLABORATIF_API_URL, useValue: TEST_API_URL },
        { provide: BoardTransport, useValue: transport },
      ],
    });
    httpMock = TestBed.inject(HttpTestingController);
    store = TestBed.inject(BoardStore);
  });

  afterEach(() => {
    httpMock.verify();
    TestBed.resetTestingModule();
  });

  // ── Emission ────────────────────────────────────────────────────────────────

  it('addConnection emits connection:create with boardId/fromId/toId', async () => {
    store.init(BOARD_ID);
    await flushInitRequests();

    store.addConnection('card-a', 'card-b');

    const emitted = transport.emitted.filter((e) => e.type === 'connection:create');
    expect(emitted).toHaveLength(1);
    expect(emitted[0].data).toEqual({ boardId: BOARD_ID, fromId: 'card-a', toId: 'card-b' });
  });

  it('deleteConnection emits connection:delete with the connection id, only for a known connection', async () => {
    store.init(BOARD_ID);
    await flushInitRequests();
    store.connections.set([makeConnection('conn-1', 'card-a', 'card-b')]);

    store.deleteConnection('conn-1');

    const emitted = transport.emitted.filter((e) => e.type === 'connection:delete');
    expect(emitted).toHaveLength(1);
    expect(emitted[0].data).toEqual({ id: 'conn-1', boardId: BOARD_ID });
  });

  it('deleteConnection is a no-op for an unknown connection id (nothing to reconcile against)', async () => {
    store.init(BOARD_ID);
    await flushInitRequests();
    store.connections.set([]);

    store.deleteConnection('does-not-exist');

    expect(transport.emitted.some((e) => e.type === 'connection:delete')).toBe(false);
  });

  // ── Optimistic apply + reconciliation ──────────────────────────────────────

  it('reconciles connection:created into state, appended once (idempotent against a duplicate broadcast)', async () => {
    store.init(BOARD_ID);
    await flushInitRequests();
    expect(store.connections()).toEqual([]);

    const created = makeConnection('conn-1', 'card-a', 'card-b');
    transport.trigger('connection:created', created);
    expect(store.connections()).toEqual([created]);

    // A duplicate/replayed broadcast for the same id must not append a second entry.
    transport.trigger('connection:created', created);
    expect(store.connections()).toHaveLength(1);
  });

  it('reconciles connection:deleted by removing the matching connection from state', async () => {
    store.init(BOARD_ID);
    await flushInitRequests();
    store.connections.set([makeConnection('conn-1', 'card-a', 'card-b'), makeConnection('conn-2', 'card-a', 'card-c')]);

    transport.trigger('connection:deleted', 'conn-1');

    expect(store.connections().map((c) => c.id)).toEqual(['conn-2']);
  });

  it('board:state reconciles the full connections list on JOIN reply', async () => {
    store.init(BOARD_ID);
    await flushInitRequests();

    const conn = makeConnection('conn-1', 'card-a', 'card-b');
    transport.trigger('board:state', { cards: [], connections: [conn], frames: [], fields: [] });

    expect(store.connections()).toEqual([conn]);
  });

  it('a connection whose endpoint card is deleted via board:import-undone-style bulk removal is dropped', async () => {
    store.init(BOARD_ID);
    await flushInitRequests();
    store.connections.set([makeConnection('conn-1', 'card-a', 'card-b')]);
    store.cards.set([makeCard('card-a'), makeCard('card-b')]);

    transport.trigger('board:import-undone', { cardIds: ['card-a'], connectionIds: [], frameIds: [] });

    expect(store.connections()).toEqual([]);
  });

  // ── Keyboard delete of a selected connection (US08.7.1 A11y AC) ────────────

  it('deleteSelected deletes a selected connection (no card in the selection) without hover', async () => {
    store.init(BOARD_ID);
    await flushInitRequests();
    const conn = makeConnection('conn-1', 'card-a', 'card-b');
    store.connections.set([conn]);
    store.selectCards(new Set(['conn-1']));

    store.deleteSelected();

    const emitted = transport.emitted.filter((e) => e.type === 'connection:delete');
    expect(emitted).toHaveLength(1);
    expect(emitted[0].data).toEqual({ id: 'conn-1', boardId: BOARD_ID });
    expect(store.selectedIds().size).toBe(0);
  });

  it('deleteSelected deletes both a selected card and a selected connection together', async () => {
    store.init(BOARD_ID);
    await flushInitRequests();
    store.cards.set([makeCard('card-a')]);
    store.connections.set([makeConnection('conn-1', 'card-a', 'card-b')]);
    store.selectCards(new Set(['card-a', 'conn-1']));

    store.deleteSelected();

    expect(transport.emitted.some((e) => e.type === 'card:delete' && (e.data as { id: string }).id === 'card-a')).toBe(true);
    expect(transport.emitted.some((e) => e.type === 'connection:delete' && (e.data as { id: string }).id === 'conn-1')).toBe(
      true,
    );
  });

  it('deleteSelected is a no-op when the selection matches neither a card nor a connection', async () => {
    store.init(BOARD_ID);
    await flushInitRequests();
    store.selectCards(new Set(['ghost-id']));
    const emittedBefore = transport.emitted.length; // init() itself emits board:join

    store.deleteSelected();

    expect(transport.emitted).toHaveLength(emittedBefore);
  });

  // ── Restyle a connection (US08.7.2) ────────────────────────────────────────

  it('updateConnection emits connection:update with exactly the provided fields (AC1)', async () => {
    store.init(BOARD_ID);
    await flushInitRequests();
    store.connections.set([makeConnection('conn-1', 'card-a', 'card-b')]);

    store.updateConnection('conn-1', { color: '#ff0000', width: 4 });

    const emitted = transport.emitted.filter((e) => e.type === 'connection:update');
    expect(emitted).toHaveLength(1);
    expect(emitted[0].data).toEqual({ id: 'conn-1', boardId: BOARD_ID, color: '#ff0000', width: 4 });
  });

  it('updateConnection omits every field not present in the patch (partial patch, AC2)', async () => {
    store.init(BOARD_ID);
    await flushInitRequests();
    store.connections.set([makeConnection('conn-1', 'card-a', 'card-b')]);

    store.updateConnection('conn-1', { shape: 'orthogonal' });

    const data = transport.emitted.find((e) => e.type === 'connection:update')?.data as Record<string, unknown>;
    expect(data).toEqual({ id: 'conn-1', boardId: BOARD_ID, shape: 'orthogonal' });
    expect('label' in data).toBe(false);
    expect('color' in data).toBe(false);
    expect('arrow' in data).toBe(false);
    expect('dashed' in data).toBe(false);
    expect('width' in data).toBe(false);
  });

  it('updateConnection with an explicit label:null emits label:null, distinct from an omitted label (AC3)', async () => {
    store.init(BOARD_ID);
    await flushInitRequests();
    store.connections.set([makeConnection('conn-1', 'card-a', 'card-b', { label: 'old label' })]);

    store.updateConnection('conn-1', { label: null });

    const data = transport.emitted.find((e) => e.type === 'connection:update')?.data as Record<string, unknown>;
    expect('label' in data).toBe(true);
    expect(data['label']).toBeNull();
  });

  it('updateConnection is a no-op for an unknown connection id', async () => {
    store.init(BOARD_ID);
    await flushInitRequests();
    store.connections.set([]);

    store.updateConnection('does-not-exist', { color: '#000000' });

    expect(transport.emitted.some((e) => e.type === 'connection:update')).toBe(false);
  });

  it('updateConnection applies the patch optimistically to local state', async () => {
    store.init(BOARD_ID);
    await flushInitRequests();
    store.connections.set([makeConnection('conn-1', 'card-a', 'card-b')]);

    store.updateConnection('conn-1', { dashed: true, width: 5 });

    const conn = store.connections().find((c) => c.id === 'conn-1');
    expect(conn?.dashed).toBe(true);
    expect(conn?.width).toBe(5);
  });

  it('reconciles connection:updated by fully replacing the connector state with the broadcast object (AC4)', async () => {
    store.init(BOARD_ID);
    await flushInitRequests();
    store.connections.set([makeConnection('conn-1', 'card-a', 'card-b', { color: '#111111', shape: 'curved', width: 2 })]);

    const updated = makeConnection('conn-1', 'card-a', 'card-b', {
      color: '#00ff00',
      shape: 'orthogonal',
      arrow: 'both',
      dashed: true,
      width: 6,
      label: 'new label',
    });
    transport.trigger('connection:updated', updated);

    expect(store.connections()).toEqual([updated]);
  });

  it('updateConnection supports undo/redo of a restyle', async () => {
    store.init(BOARD_ID);
    await flushInitRequests();
    store.connections.set([makeConnection('conn-1', 'card-a', 'card-b', { color: '#111111' })]);

    store.updateConnection('conn-1', { color: '#00ff00' });
    expect(store.connections().find((c) => c.id === 'conn-1')?.color).toBe('#00ff00');

    store.undo();
    expect(store.connections().find((c) => c.id === 'conn-1')?.color).toBe('#111111');

    store.redo();
    expect(store.connections().find((c) => c.id === 'conn-1')?.color).toBe('#00ff00');
  });
});

describe('BoardStore — F1 optimistic card creation', () => {
  let httpMock: HttpTestingController;
  let transport: FakeBoardTransport;
  let store: BoardStore;

  async function flushInitRequests(): Promise<void> {
    httpMock.expectOne((r) => r.url === `${TEST_API_URL}/whiteboard/boards/${BOARD_ID}`).flush({
      id: BOARD_ID,
      title: 'Board',
      role: 'OWNER',
      description: null,
      coverImage: null,
      maxParticipants: null,
      enabledActivities: [],
    });
    httpMock.expectOne((r) => r.url === `${TEST_API_URL}/whiteboard/boards/${BOARD_ID}/members`).flush([]);
    httpMock
      .expectOne((r) => r.url === `${TEST_API_URL}/whiteboard/boards/${BOARD_ID}/vote/current`)
      .flush('', { status: 404, statusText: 'Not Found' });
    httpMock
      .expectOne((r) => r.url === `${TEST_API_URL}/whiteboard/boards/${BOARD_ID}/vote/last`)
      .flush('', { status: 404, statusText: 'Not Found' });
    await Promise.resolve();
    await Promise.resolve();
  }

  beforeEach(() => {
    transport = new FakeBoardTransport();
    TestBed.configureTestingModule({
      providers: [
        BoardStore,
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: Router, useValue: { navigateByUrl: vi.fn().mockResolvedValue(true) } },
        { provide: COLLABORATIF_API_URL, useValue: TEST_API_URL },
        { provide: BoardTransport, useValue: transport },
      ],
    });
    httpMock = TestBed.inject(HttpTestingController);
    store = TestBed.inject(BoardStore);
  });

  afterEach(() => {
    httpMock.verify();
    TestBed.resetTestingModule();
  });

  /** Extracts the clientTag attached to the (single) card:create emit. */
  function emittedClientTag(): string {
    const call = transport.emitted.find((e) => e.type === 'card:create');
    expect(call).toBeDefined();
    return (call!.data as { clientTag: string }).clientTag;
  }

  it('renders a provisional card immediately, before any server echo', async () => {
    store.init(BOARD_ID);
    await flushInitRequests();
    expect(store.cards()).toHaveLength(0);

    store.addCard(10, 20, 'TEXT', 'hello', '#FFEB3B', 180, 140);

    expect(store.cards()).toHaveLength(1);
    const card = store.cards()[0];
    expect(card.posX).toBe(10);
    expect(card.posY).toBe(20);
    expect(card.type).toBe('TEXT');
    expect(card.content).toBe('hello');
    expect(card.color).toBe('#FFEB3B');
    expect(card.width).toBe(180);
    expect(card.height).toBe(140);
    expect(card.fieldValues).toEqual([]);
    // The provisional card is keyed by the emitted clientTag (temporary id).
    expect(card.id).toBe(emittedClientTag());
  });

  it('opens the provisional card in edit mode immediately (autoEditCardId = clientTag)', async () => {
    store.init(BOARD_ID);
    await flushInitRequests();

    store.addCard(10, 20, 'TEXT', '', '#FFEB3B', 180, 140);

    expect(store.autoEditCardId()).toBe(emittedClientTag());
  });

  it('reconciles the matching echo in place — replaces the provisional card, no duplicate', async () => {
    store.init(BOARD_ID);
    await flushInitRequests();
    store.addCard(10, 20, 'TEXT', 'hello', '#FFEB3B', 180, 140);
    const clientTag = emittedClientTag();

    transport.trigger('card:created', {
      ...makeCard('server-id', { content: 'hello', posX: 10, posY: 20 }),
      clientTag,
    });

    expect(store.cards()).toHaveLength(1);
    expect(store.cards()[0].id).toBe('server-id');
    expect(store.cards().some((c) => c.id === clientTag)).toBe(false);
  });

  it('moves autoEditCardId from the clientTag to the reconciled server id', async () => {
    store.init(BOARD_ID);
    await flushInitRequests();
    store.addCard(10, 20, 'TEXT', '', '#FFEB3B', 180, 140);
    const clientTag = emittedClientTag();
    expect(store.autoEditCardId()).toBe(clientTag);

    transport.trigger('card:created', { ...makeCard('server-id'), clientTag });

    expect(store.autoEditCardId()).toBe('server-id');
  });

  it('BUG A — the provisional card carries a stable key equal to its clientTag', async () => {
    store.init(BOARD_ID);
    await flushInitRequests();
    store.addCard(10, 20, 'TEXT', '', '#FFEB3B', 180, 140);

    expect(store.cards()[0].key).toBe(emittedClientTag());
  });

  it('BUG A — reconciling card:created preserves the stable key across the id swap (no re-mount)', async () => {
    store.init(BOARD_ID);
    await flushInitRequests();
    store.addCard(10, 20, 'TEXT', 'hello', '#FFEB3B', 180, 140);
    const clientTag = emittedClientTag();
    const stableKey = store.cards()[0].key;
    expect(stableKey).toBe(clientTag);

    // The server echo carries the real uuid but NO key — the optimistic one must be carried over
    // so the canvas `@for` trackBy (card.key ?? card.id) sees no change and never re-mounts the
    // board-card mid-edit (which would drop the in-flight textarea content — BUG A).
    transport.trigger('card:created', {
      ...makeCard('server-id', { content: 'hello', posX: 10, posY: 20 }),
      clientTag,
    });

    expect(store.cards()).toHaveLength(1);
    const reconciled = store.cards()[0];
    expect(reconciled.id).toBe('server-id');
    expect(reconciled.key).toBe(stableKey);
  });

  it('appends a card:created with an unknown clientTag (another participant)', async () => {
    store.init(BOARD_ID);
    await flushInitRequests();

    transport.trigger('card:created', makeCard('remote-card'));

    expect(store.cards().some((c) => c.id === 'remote-card')).toBe(true);
    expect(store.autoEditCardId()).toBeNull();
  });

  it('reaps the provisional card if the server never echoes (safety timeout)', async () => {
    // NB: a pass-through `setTimeout` spy (not `vi.useFakeTimers()`) — fake timers leak across
    // this non-isolated worker and break sibling specs that mock `@stomp/rx-stomp`. The spy
    // still delegates to the real timer; we only reach in to fire the reaper callback directly.
    const timeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    try {
      store.init(BOARD_ID);
      await flushInitRequests();

      store.addCard(10, 20, 'TEXT', 'hello', '#FFEB3B', 180, 140);
      expect(store.cards()).toHaveLength(1);

      // The reaper is the 10s timer registered by addCard — invoke it as the platform would.
      const reaper = timeoutSpy.mock.calls.find(([, delay]) => delay === 10_000)?.[0] as
        | (() => void)
        | undefined;
      expect(reaper).toBeDefined();
      reaper!();

      expect(store.cards()).toHaveLength(0);
    } finally {
      timeoutSpy.mockRestore();
    }
  });
});

describe('BoardStore — F3 presence join payload', () => {
  let httpMock: HttpTestingController;
  let transport: FakeBoardTransport;

  async function flushInitRequests(): Promise<void> {
    httpMock.expectOne((r) => r.url === `${TEST_API_URL}/whiteboard/boards/${BOARD_ID}`).flush({
      id: BOARD_ID, title: 'Board', role: 'OWNER', description: null,
      coverImage: null, maxParticipants: null, enabledActivities: [],
    });
    httpMock.expectOne((r) => r.url === `${TEST_API_URL}/whiteboard/boards/${BOARD_ID}/members`).flush([]);
    httpMock.expectOne((r) => r.url === `${TEST_API_URL}/whiteboard/boards/${BOARD_ID}/vote/current`)
      .flush('', { status: 404, statusText: 'Not Found' });
    httpMock.expectOne((r) => r.url === `${TEST_API_URL}/whiteboard/boards/${BOARD_ID}/vote/last`)
      .flush('', { status: 404, statusText: 'Not Found' });
    await Promise.resolve();
    await Promise.resolve();
  }

  function configure(currentUser?: () => { displayName: string | null; avatarUrl: string | null }): BoardStore {
    transport = new FakeBoardTransport();
    TestBed.configureTestingModule({
      providers: [
        BoardStore,
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: Router, useValue: { navigateByUrl: vi.fn().mockResolvedValue(true) } },
        { provide: COLLABORATIF_API_URL, useValue: TEST_API_URL },
        { provide: BoardTransport, useValue: transport },
        ...(currentUser ? [{ provide: COLLABORATIF_CURRENT_USER, useValue: currentUser }] : []),
      ],
    });
    httpMock = TestBed.inject(HttpTestingController);
    return TestBed.inject(BoardStore);
  }

  afterEach(() => {
    httpMock.verify();
    TestBed.resetTestingModule();
  });

  function joinCalls(): Array<Record<string, unknown>> {
    return transport.emitted
      .filter((e) => e.type === 'board:join')
      .map((e) => e.data as Record<string, unknown>);
  }

  it('emits board:join with the current user displayName + avatarUrl (not a bare boardId string)', async () => {
    const store = configure(() => ({ displayName: 'Alice', avatarUrl: 'http://a/x.png' }));
    store.init(BOARD_ID);
    await flushInitRequests();

    const calls = joinCalls();
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({ displayName: 'Alice', avatarUrl: 'http://a/x.png' });
    expect(typeof calls[0]).toBe('object');
  });

  it('re-emits the same join payload on reconnect', async () => {
    const store = configure(() => ({ displayName: 'Alice', avatarUrl: 'http://a/x.png' }));
    store.init(BOARD_ID);
    await flushInitRequests();

    transport.triggerReconnect();

    const calls = joinCalls();
    expect(calls).toHaveLength(2);
    expect(calls[1]).toEqual({ displayName: 'Alice', avatarUrl: 'http://a/x.png' });
  });

  it('omits displayName when unknown so the backend applies its Anonymous fallback', async () => {
    const store = configure(); // default accessor → { displayName: null, avatarUrl: null }
    store.init(BOARD_ID);
    await flushInitRequests();

    const calls = joinCalls();
    expect(calls).toHaveLength(1);
    expect(calls[0]).not.toHaveProperty('displayName');
    expect(calls[0]).not.toHaveProperty('avatarUrl');
  });

  it('still emits board:leave unchanged (contract preserved)', async () => {
    const store = configure(() => ({ displayName: 'Alice', avatarUrl: null }));
    store.init(BOARD_ID);
    await flushInitRequests();

    store.destroy();

    const leave = transport.emitted.find((e) => e.type === 'board:leave');
    expect(leave).toBeDefined();
    expect(leave!.data).toBe(BOARD_ID);
  });
});

describe('BoardStore — dot-vote tallies and budget (US08.12.2)', () => {
  let store: BoardStore;
  let transport: FakeTransport;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        BoardStore,
        { provide: BoardTransport, useClass: FakeTransport },
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: Router, useValue: { navigateByUrl: vi.fn().mockResolvedValue(true) } },
        { provide: COLLABORATIF_API_URL, useValue: TEST_API_URL },
      ],
    });
    store = TestBed.inject(BoardStore);
    transport = TestBed.inject(BoardTransport) as unknown as FakeTransport;
  });

  function session(votes: Array<{ cardId: string; userId: string }>, votesPerPerson = 3): VoteSession {
    return {
      id: 'sess-1',
      boardId: 'b',
      status: 'ACTIVE',
      votesPerPerson,
      timerSeconds: null,
      timerEndsAt: null,
      voterIds: [],
      votes: votes.map(
        (v, i): BoardVote => ({ id: `v${i}`, sessionId: 'sess-1', cardId: v.cardId, userId: v.userId, createdAt: '' }),
      ),
      createdAt: '',
      closedAt: null,
    };
  }

  it('tallies total and own votes per card and derives the remaining budget', () => {
    store.selfUserId.set('me');
    store.activeVoteSession.set(
      session([
        { cardId: 'c1', userId: 'me' },
        { cardId: 'c1', userId: 'other' },
        { cardId: 'c2', userId: 'me' },
      ]),
    );
    expect(store.voteTallyByCard().get('c1')).toBe(2);
    expect(store.voteTallyByCard().get('c2')).toBe(1);
    expect(store.myVoteTallyByCard().get('c1')).toBe(1);
    expect(store.myVotesUsed()).toBe(2);
    expect(store.voteBudgetRemaining()).toBe(1);
  });

  it('does not emit a cast once the per-person budget is spent', () => {
    store.selfUserId.set('me');
    store.activeVoteSession.set(session([{ cardId: 'c1', userId: 'me' }, { cardId: 'c2', userId: 'me' }], 2));
    store.castVote('c3');
    expect(transport.emitted.filter((e) => e.type === 'vote:cast')).toHaveLength(0);
  });

  it('emits a cast while budget remains', () => {
    store.selfUserId.set('me');
    store.activeVoteSession.set(session([{ cardId: 'c1', userId: 'me' }], 3));
    store.castVote('c2');
    const cast = transport.emitted.find((e) => e.type === 'vote:cast');
    expect(cast).toBeDefined();
    expect((cast!.data as { cardId: string }).cardId).toBe('c2');
  });

  it('only un-casts a card the current user has actually voted for', () => {
    store.selfUserId.set('me');
    store.activeVoteSession.set(session([{ cardId: 'c1', userId: 'me' }], 3));
    store.uncastVote('c2');
    expect(transport.emitted.filter((e) => e.type === 'vote:uncast')).toHaveLength(0);
    store.uncastVote('c1');
    expect(transport.emitted.filter((e) => e.type === 'vote:uncast')).toHaveLength(1);
  });
});

function makeFrame(id: string, overrides: Partial<Frame> = {}): Frame {
  return {
    id,
    boardId: BOARD_ID,
    title: '',
    posX: 0,
    posY: 0,
    width: 300,
    height: 200,
    color: '#EDE9FE',
    active: false,
    layer: 1,
    ...overrides,
  };
}

describe('BoardStore — z-order front/back (US08.9.3)', () => {
  let httpMock: HttpTestingController;
  let transport: FakeBoardTransport;
  let store: BoardStore;

  async function flushInitRequests(): Promise<void> {
    httpMock.expectOne((r) => r.url === `${TEST_API_URL}/whiteboard/boards/${BOARD_ID}`).flush({
      id: BOARD_ID,
      title: 'Board',
      role: 'OWNER',
      description: null,
      coverImage: null,
      maxParticipants: null,
      enabledActivities: [],
    });
    httpMock.expectOne((r) => r.url === `${TEST_API_URL}/whiteboard/boards/${BOARD_ID}/members`).flush([]);
    httpMock
      .expectOne((r) => r.url === `${TEST_API_URL}/whiteboard/boards/${BOARD_ID}/vote/current`)
      .flush('', { status: 404, statusText: 'Not Found' });
    httpMock
      .expectOne((r) => r.url === `${TEST_API_URL}/whiteboard/boards/${BOARD_ID}/vote/last`)
      .flush('', { status: 404, statusText: 'Not Found' });
    await Promise.resolve();
    await Promise.resolve();
  }

  beforeEach(() => {
    transport = new FakeBoardTransport();
    TestBed.configureTestingModule({
      providers: [
        BoardStore,
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: Router, useValue: { navigateByUrl: vi.fn().mockResolvedValue(true) } },
        { provide: COLLABORATIF_API_URL, useValue: TEST_API_URL },
        { provide: BoardTransport, useValue: transport },
      ],
    });
    httpMock = TestBed.inject(HttpTestingController);
    store = TestBed.inject(BoardStore);
  });

  afterEach(() => {
    httpMock.verify();
    TestBed.resetTestingModule();
  });

  it('derives frontLayer/backLayer from the extent over cards AND frames', () => {
    store.cards.set([makeCard('c1', { layer: 2 }), makeCard('c2', { layer: 5 })]);
    store.frames.set([makeFrame('f1', { layer: 9 }), makeFrame('f2', { layer: -1 })]);

    expect(store.frontLayer()).toBe(10); // max(2,5,9,-1) + 1
    expect(store.backLayer()).toBe(-2); // min(2,5,9,-1) - 1
  });

  it('falls back to a sane layer on an empty board', () => {
    store.cards.set([]);
    store.frames.set([]);

    expect(store.frontLayer()).toBe(2);
    expect(store.backLayer()).toBe(0);
  });

  it('setLayerSelected applies to ALL selected cards including locked ones (z-order is not gated by lock)', async () => {
    store.init(BOARD_ID);
    await flushInitRequests();
    store.cards.set([
      makeCard('c1', { layer: 1, locked: false }),
      makeCard('c2', { layer: 1, locked: true }),
      makeCard('c3', { layer: 5 }),
    ]);
    store.selectCards(new Set(['c1', 'c2']));

    store.setLayerSelected(store.frontLayer()); // frontLayer = 6

    const layered = transport.emitted.filter((e) => e.type === 'card:layer');
    expect(layered).toHaveLength(2);
    expect(layered.map((e) => (e.data as { id: string; layer: number }).id).sort()).toEqual(['c1', 'c2']);
    expect(layered.every((e) => (e.data as { layer: number }).layer === 6)).toBe(true);
    expect(store.cards().find((c) => c.id === 'c2')?.layer).toBe(6);
  });

  it('setFrameLayer emits frame:layer with the send-to-back target', async () => {
    store.init(BOARD_ID);
    await flushInitRequests();
    store.cards.set([makeCard('c1', { layer: 3 })]);
    store.frames.set([makeFrame('f1', { layer: 3 })]);

    store.setFrameLayer('f1', store.backLayer()); // backLayer = min(3,3) - 1 = 2

    const layered = transport.emitted.filter((e) => e.type === 'frame:layer');
    expect(layered).toHaveLength(1);
    expect(layered[0].data).toEqual({ id: 'f1', boardId: BOARD_ID, layer: 2 });
    expect(store.frames()[0].layer).toBe(2);
  });
});
