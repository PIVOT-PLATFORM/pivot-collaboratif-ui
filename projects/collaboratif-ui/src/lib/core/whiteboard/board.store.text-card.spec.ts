import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { BoardStore } from './board.store';
import { BoardTransport } from './board-transport';
import { COLLABORATIF_API_URL } from './config/tokens';
import type { Card } from '../../whiteboard/model/board.types';

const TEST_API_URL = 'http://localhost:8083/api/collaboratif';
const BOARD_ID = 'board-1';

/**
 * In-memory {@link BoardTransport} double — records every {@code emit} call and lets tests
 * drive inbound broadcasts synchronously via {@link FakeTransport#trigger}, mirroring how
 * {@code StompBoardTransport} would demultiplex a real {@code /topic/whiteboard/{boardId}}
 * frame to the handler {@link BoardStore#registerHandlers} registered for that wire type.
 */
class FakeTransport extends BoardTransport {
  readonly emitted: { type: string; data: unknown }[] = [];
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

  /** Delivers a fake inbound broadcast to every handler registered for `type`. */
  trigger<T>(type: string, data: T): void {
    this.handlers.get(type)?.forEach((h) => h(data));
  }

  /** Returns the last recorded `emit` call for the given wire type, if any. */
  lastEmit(type: string): unknown {
    return [...this.emitted].reverse().find((e) => e.type === type)?.data;
  }
}

function makeTextCard(overrides: Partial<Card> = {}): Card {
  return {
    id: 'card-1',
    boardId: BOARD_ID,
    type: 'TEXT',
    content: 'hello',
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

describe('BoardStore — US08.6.1 TEXT card lifecycle', () => {
  let httpMock: HttpTestingController;
  let transport: FakeTransport;
  let store: BoardStore;
  let rafCallbacks: FrameRequestCallback[];

  beforeEach(() => {
    rafCallbacks = [];
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      rafCallbacks.push(cb);
      return rafCallbacks.length;
    });
    vi.stubGlobal('cancelAnimationFrame', () => {});

    TestBed.configureTestingModule({
      providers: [
        BoardStore,
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: COLLABORATIF_API_URL, useValue: TEST_API_URL },
        { provide: BoardTransport, useClass: FakeTransport },
      ],
    });
    httpMock = TestBed.inject(HttpTestingController);
    transport = TestBed.inject(BoardTransport) as unknown as FakeTransport;
    store = TestBed.inject(BoardStore);
  });

  afterEach(() => {
    httpMock.verify();
    vi.unstubAllGlobals();
    TestBed.resetTestingModule();
  });

  /** Flushes the four read-only GETs `BoardStore.init()` fires, same shape as board-page's spec. */
  async function initAndFlush(): Promise<void> {
    store.init(BOARD_ID);
    httpMock.expectOne(`${TEST_API_URL}/whiteboard/boards/${BOARD_ID}`).flush({
      id: BOARD_ID, title: 'Board', description: null, coverImage: null,
      maxParticipants: null, enabledActivities: [], role: 'OWNER',
    });
    httpMock.expectOne(`${TEST_API_URL}/whiteboard/boards/${BOARD_ID}/members`).flush([]);
    httpMock.expectOne(`${TEST_API_URL}/whiteboard/boards/${BOARD_ID}/vote/current`)
      .flush('', { status: 404, statusText: 'Not Found' });
    httpMock.expectOne(`${TEST_API_URL}/whiteboard/boards/${BOARD_ID}/vote/last`)
      .flush('', { status: 404, statusText: 'Not Found' });
    await Promise.resolve();
    await Promise.resolve();
  }

  function flushRaf(): void {
    const callbacks = [...rafCallbacks];
    rafCallbacks = [];
    callbacks.forEach((cb) => cb(0));
  }

  // ── Rendu + réconciliation clientTag → id serveur ──────────────────────────

  it('reconciles a self-created TEXT card via clientTag and flags it for auto-edit', async () => {
    await initAndFlush();

    store.addCard(10, 20, 'TEXT', 'a new sticky note');

    const createCall = transport.emitted.find((e) => e.type === 'card:create');
    expect(createCall).toBeDefined();
    const clientTag = (createCall!.data as { clientTag: string }).clientTag;
    expect(clientTag).toBeTruthy();

    // Server echo: card:created carries the same clientTag plus the server-assigned id.
    transport.trigger('card:created', { ...makeTextCard({ id: 'server-id-1', content: 'a new sticky note' }), clientTag });

    expect(store.cards().some((c) => c.id === 'server-id-1')).toBe(true);
    expect(store.autoEditCardId()).toBe('server-id-1');
  });

  it('does not flag a remote user\'s card:created for auto-edit (no matching clientTag)', async () => {
    await initAndFlush();

    transport.trigger('card:created', makeTextCard({ id: 'remote-card' }));

    expect(store.cards().some((c) => c.id === 'remote-card')).toBe(true);
    expect(store.autoEditCardId()).toBeNull();
  });

  // ── Application optimiste move/resize ──────────────────────────────────────

  it('applies moveCard optimistically before the transport emit is flushed', async () => {
    await initAndFlush();
    store.cards.set([makeTextCard()]);

    store.moveCard('card-1', 42, 84);

    // Optimistic local state is updated synchronously.
    expect(store.cards().find((c) => c.id === 'card-1')?.posX).toBe(42);
    expect(store.cards().find((c) => c.id === 'card-1')?.posY).toBe(84);

    // The wire emit is rAF-batched — nothing sent yet until the frame flushes.
    expect(transport.emitted.some((e) => e.type === 'card:move')).toBe(false);
    flushRaf();
    const moveCall = transport.lastEmit('card:move') as { id: string; posX: number; posY: number };
    expect(moveCall).toEqual({ id: 'card-1', boardId: BOARD_ID, posX: 42, posY: 84 });
  });

  it('applies resizeCard and emits card:resize', async () => {
    await initAndFlush();
    store.cards.set([makeTextCard()]);

    store.resizeCard('card-1', 300, 200);

    const resizeCall = transport.lastEmit('card:resize');
    expect(resizeCall).toEqual({ id: 'card-1', boardId: BOARD_ID, width: 300, height: 200 });
  });

  // ── Édition de contenu ──────────────────────────────────────────────────────

  it('emits card:update on content edit and applies the server echo (card:updated)', async () => {
    await initAndFlush();
    store.cards.set([makeTextCard()]);

    store.updateCard('card-1', 'edited content');
    expect(transport.lastEmit('card:update')).toEqual({ id: 'card-1', boardId: BOARD_ID, content: 'edited content' });

    // updateCard does not apply content optimistically — only the room-wide echo does
    // (parity spec §6.11: card:updated goes to the whole room, emitter included).
    expect(store.cards().find((c) => c.id === 'card-1')?.content).toBe('hello');

    transport.trigger('card:updated', { ...makeTextCard(), content: 'edited content' });
    expect(store.cards().find((c) => c.id === 'card-1')?.content).toBe('edited content');
  });

  it('does not emit card:update when content is unchanged', async () => {
    await initAndFlush();
    store.cards.set([makeTextCard({ content: 'same' })]);

    store.updateCard('card-1', 'same');

    expect(transport.emitted.some((e) => e.type === 'card:update')).toBe(false);
  });

  // ── Recoloration ─────────────────────────────────────────────────────────────

  it('applies recolorCard optimistically and emits card:recolor', async () => {
    await initAndFlush();
    store.cards.set([makeTextCard({ color: '#FFEB3B' })]);

    store.recolorCard('card-1', '#00FF00');

    expect(store.cards().find((c) => c.id === 'card-1')?.color).toBe('#00FF00');
    expect(transport.lastEmit('card:recolor')).toEqual({ id: 'card-1', boardId: BOARD_ID, color: '#00FF00' });
  });

  // ── Détection d'URL → card:meta_updated ──────────────────────────────────────

  it('applies an OpenGraph meta payload delivered via card:meta_updated', async () => {
    await initAndFlush();
    store.cards.set([makeTextCard({ content: 'see https://example.com', meta: null })]);

    transport.trigger('card:meta_updated', {
      id: 'card-1',
      meta: { title: 'Example', description: 'desc', siteName: 'example.com' },
    });

    expect(store.cards().find((c) => c.id === 'card-1')?.meta).toEqual({
      title: 'Example', description: 'desc', siteName: 'example.com',
    });
  });

  it('resets meta to null when card:meta_updated reports the URL was removed', async () => {
    await initAndFlush();
    store.cards.set([
      makeTextCard({ content: 'no more link', meta: { title: 'stale' } }),
    ]);

    transport.trigger('card:meta_updated', { id: 'card-1', meta: null });

    expect(store.cards().find((c) => c.id === 'card-1')?.meta).toBeNull();
  });
});
