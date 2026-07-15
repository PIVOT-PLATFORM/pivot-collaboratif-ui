import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Router } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BoardStore } from './board.store';
import { BoardTransport } from './board-transport';
import { COLLABORATIF_API_URL } from './config/tokens';
import type { Card, Connection } from '../../whiteboard/model/board.types';

const TEST_API_URL = 'http://localhost:8083/api/collaboratif';
const BOARD_ID = 'board-1';

/**
 * Test double for {@link BoardTransport} — records `emit()` calls and lets tests dispatch
 * inbound broadcasts synchronously via {@link FakeTransport.dispatch}, with a controllable
 * {@link FakeTransport.getSessionId} for the fix/EN08.4 sender-exclusion tests below.
 */
class FakeTransport extends BoardTransport {
  readonly emitted: { type: string; data: unknown }[] = [];
  private sessionId = 'my-session-id';
  private readonly handlers = new Map<string, Set<(data: unknown) => void>>();

  connect(): void {}
  disconnect(): void {}

  emit(type: string, data: unknown): void {
    this.emitted.push({ type, data });
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

  onReconnect(): () => void {
    return () => {};
  }

  getSessionId(): string {
    return 'fake-board-transport-session';
  }

  /** Simulates the server broadcasting `type` with `data` to every registered handler. */
  trigger<T>(type: string, data: T): void {
    this.handlers.get(type)?.forEach((h) => h(data));
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
});
