import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Router } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BoardStore } from './board.store';
import { BoardTransport } from './board-transport';
import { COLLABORATIF_API_URL } from './config/tokens';
import type { Card } from '../../whiteboard/model/board.types';

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
