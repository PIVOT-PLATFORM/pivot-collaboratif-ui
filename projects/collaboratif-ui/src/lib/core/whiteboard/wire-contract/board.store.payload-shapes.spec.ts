import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Router } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BoardStore } from '../board.store';
import { BoardTransport, StompBoardTransport } from '../board-transport';
import { COLLABORATIF_API_URL, COLLABORATIF_BEARER_TOKEN } from '../config/tokens';
import type { Card, Connection } from '../../../whiteboard/model/board.types';
import cardDtoFixtureJson from './card-dto.json';
import cardConnectionDtoFixtureJson from './card-connection-dto.json';
import boardStateFixtureJson from './board-state.json';

/**
 * EN08.5 — Couche 2 (forme de payload) — Test de contrat wire, côté FRONTEND consommateur.
 *
 * Charge les fixtures canoniques COMMITTÉES (copiées à l'identique depuis
 * `pivot-collaboratif-core`, voir `wire-contract/README.md`) et pilote la réconciliation
 * `BoardStore` avec elles — jamais un mock reconstruit à la main. Le but : garantir que le
 * front parse EXACTEMENT ce que le back sérialise (casse des champs, noms exacts).
 *
 * `card-dto.json`/`card-connection-dto.json`/`board-state.json` all correspond to the
 * "structured canvas" wire protocol owned by `BoardStore`/`BoardTransport` — see
 * `board.store.wire-contract.spec.ts` for the vocabulary-level test. `participants-update.json`
 * belongs to a *different* transport (`WhiteboardSyncService`'s dedicated `/presence` subtopic —
 * see `participants-presence.spec.ts` next to this file) and is deliberately NOT exercised here:
 * `BoardStore.presence`'s `board:presence` handler consumes a distinct `PresenceUser[]` shape
 * (`{id, name, avatar}`) that has no relationship to `ParticipantInfo`'s fields
 * (`userId`/`displayName`/`avatarUrl`/`color`/`role`) — routing `participants-update.json`
 * through `BoardStore` would silently test the wrong consumer.
 */

/** Shape of `card-dto.json`, as generated from the backend's real `CardDto`. */
interface CardDtoFixture {
  id: string;
  type: string;
  content: string;
  meta: { title?: string; description?: string; image?: string; siteName?: string } | null;
  posX: number;
  posY: number;
  width: number;
  height: number;
  color: string;
  groupId: string | null;
  groupColor: string | null;
  locked: boolean;
  layer: number;
}

/** Shape of `card-connection-dto.json`, as generated from the backend's real `ConnectionDto`. */
interface ConnectionDtoFixture {
  id: string;
  fromId: string;
  toId: string;
  label: string | null;
  color: string | null;
  shape: string;
  arrow: string;
  dashed: boolean;
  width: number;
}

/** Shape of `board-state.json` — the full `board:state` broadcast envelope, as emitted on JOIN. */
interface BoardStateFixture {
  type: 'board:state';
  boardId: string;
  userId: string;
  data: {
    cards: CardDtoFixture[];
    connections: ConnectionDtoFixture[];
    frames: unknown[];
    fields: unknown[];
  };
}

const TEST_API_URL = 'http://localhost:8083/api/collaboratif';
const BOARD_ID = 'board-1';

/**
 * Test double for {@link BoardTransport} — records `emit()` calls and lets tests dispatch
 * inbound broadcasts synchronously via {@link FakeTransport.dispatch}. Duplicated from
 * `board.store.spec.ts` rather than imported/shared — self-contained spec files are the
 * established convention in this folder (see `board-transport.spec.ts`'s rationale comment).
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

  getSessionId(): string {
    return 'fixture-session';
  }

  /** Fires every handler registered for `type`, simulating an inbound broadcast. */
  dispatch<T>(type: string, data: T): void {
    this.handlers.get(type)?.forEach((h) => h(data));
  }
}

describe('BoardStore payload reconciliation vs. canonical fixtures (EN08.5, Couche 2)', () => {
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
  });

  afterEach(() => {
    httpMock.verify();
  });

  describe('card-dto.json', () => {
    const fixture = cardDtoFixtureJson as CardDtoFixture;

    it('card:created reconciles every field from the fixture, exact names and casing', () => {
      transport.dispatch('card:created', fixture);

      const card = store.cards().find((c) => c.id === fixture.id);
      expect(card).toBeTruthy();
      expect(card).toMatchObject({
        id: fixture.id,
        type: fixture.type,
        content: fixture.content,
        meta: fixture.meta,
        posX: fixture.posX,
        posY: fixture.posY,
        width: fixture.width,
        height: fixture.height,
        color: fixture.color,
        groupId: fixture.groupId,
        groupColor: fixture.groupColor,
        locked: fixture.locked,
        layer: fixture.layer,
      });
    });

    it('card:updated applies the fixture\'s content-bearing fields (type/content/meta/color/groupId/groupColor/locked/layer)', () => {
      // card:updated is a content-only patch by design (see board.store.ts's registerHandlers()
      // comment on card:updated) — posX/posY/width/height are deliberately excluded from the
      // applied patch, so this test seeds a pre-existing card with different geometry and
      // asserts that geometry survives untouched while every other fixture field lands exactly.
      const seeded: Card = {
        id: fixture.id,
        boardId: BOARD_ID,
        type: 'TEXT',
        content: 'stale',
        meta: null,
        posX: 1,
        posY: 2,
        width: 3,
        height: 4,
        color: '#000000',
        groupId: null,
        groupColor: null,
        locked: false,
        layer: 0,
        fieldValues: [],
      };
      store.cards.set([seeded]);

      transport.dispatch('card:updated', fixture as unknown as Card);

      const card = store.cards().find((c) => c.id === fixture.id);
      expect(card).toMatchObject({
        type: fixture.type,
        content: fixture.content,
        meta: fixture.meta,
        color: fixture.color,
        groupId: fixture.groupId,
        groupColor: fixture.groupColor,
        locked: fixture.locked,
        layer: fixture.layer,
      });
      // Geometry from the (stale) seed, NOT the fixture — intentional, see comment above.
      expect(card).toMatchObject({ posX: 1, posY: 2, width: 3, height: 4 });
    });
  });

  describe('card-connection-dto.json', () => {
    const fixture = cardConnectionDtoFixtureJson as ConnectionDtoFixture;

    it('connection:created reconciles every field from the fixture, exact names and casing', () => {
      transport.dispatch('connection:created', fixture);

      const conn = store.connections().find((c) => c.id === fixture.id);
      expect(conn).toMatchObject({
        id: fixture.id,
        fromId: fixture.fromId,
        toId: fixture.toId,
        label: fixture.label,
        color: fixture.color,
        shape: fixture.shape,
        arrow: fixture.arrow,
        dashed: fixture.dashed,
        width: fixture.width,
      });
    });

    it('connection:updated replaces the stored connection wholesale with the fixture\'s fields', () => {
      // connection:updated is a full-replace, not a merge (see board.store.ts's comment on
      // connection:updated) — seed a different prior connection with the same id and assert the
      // fixture's values win outright, including a field the prior value had non-null.
      store.connections.set([
        {
          id: fixture.id,
          boardId: BOARD_ID,
          fromId: 'stale-from',
          toId: 'stale-to',
          label: 'stale label',
          color: '#000000',
          shape: 'orthogonal',
          arrow: 'none',
          dashed: false,
          width: 1,
        },
      ]);

      transport.dispatch('connection:updated', fixture as unknown as Connection);

      const conn = store.connections().find((c) => c.id === fixture.id);
      expect(conn).toMatchObject({
        fromId: fixture.fromId,
        toId: fixture.toId,
        label: fixture.label,
        color: fixture.color,
        shape: fixture.shape,
        arrow: fixture.arrow,
        dashed: fixture.dashed,
        width: fixture.width,
      });
    });
  });

  describe('board-state.json', () => {
    const fixture = boardStateFixtureJson as BoardStateFixture;

    it('board:state reconciles both the fixture\'s cards and connections into state', () => {
      // `envelope.data` is what BoardTransport's real dispatch() hands to the 'board:state'
      // handler (see the envelope-unwrapping test below for the real BoardTransport doing this
      // unwrapping) — FakeTransport.dispatch is fed the already-unwrapped `data` payload here to
      // isolate BoardStore's reconciliation logic from the transport's envelope parsing.
      transport.dispatch('board:state', fixture.data);

      expect(store.cards()).toHaveLength(1);
      expect(store.cards()[0]).toMatchObject({
        id: fixture.data.cards[0].id,
        type: fixture.data.cards[0].type,
        content: fixture.data.cards[0].content,
        meta: fixture.data.cards[0].meta,
        posX: fixture.data.cards[0].posX,
        posY: fixture.data.cards[0].posY,
        width: fixture.data.cards[0].width,
        height: fixture.data.cards[0].height,
        color: fixture.data.cards[0].color,
        groupId: fixture.data.cards[0].groupId,
        groupColor: fixture.data.cards[0].groupColor,
        locked: fixture.data.cards[0].locked,
        layer: fixture.data.cards[0].layer,
      });

      expect(store.connections()).toHaveLength(1);
      expect(store.connections()[0]).toMatchObject({
        id: fixture.data.connections[0].id,
        fromId: fixture.data.connections[0].fromId,
        toId: fixture.data.connections[0].toId,
        label: fixture.data.connections[0].label,
        color: fixture.data.connections[0].color,
        shape: fixture.data.connections[0].shape,
        arrow: fixture.data.connections[0].arrow,
        dashed: fixture.data.connections[0].dashed,
        width: fixture.data.connections[0].width,
      });
    });

    it('the real BoardTransport unwraps the full {type, boardId, userId, data} envelope and hands only `data` to the handler', () => {
      // Exercises the actual StompBoardTransport envelope parsing (not FakeTransport) against
      // the literal fixture bytes, the way a real STOMP frame body would arrive — see
      // board-transport.spec.ts for the established convention of poking private fields to
      // avoid mocking @stomp/rx-stomp's constructor in this file too.
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        providers: [
          StompBoardTransport,
          { provide: COLLABORATIF_API_URL, useValue: TEST_API_URL },
          { provide: COLLABORATIF_BEARER_TOKEN, useValue: (): string | null => null },
        ],
      });
      const realTransport = TestBed.inject(StompBoardTransport);
      let received: unknown = null;
      realTransport.on('board:state', (data) => {
        received = data;
      });

      const dispatchBody = (realTransport as unknown as { dispatch: (body: string) => void }).dispatch.bind(realTransport);
      dispatchBody(JSON.stringify(fixture));

      expect(received).toEqual(fixture.data);
    });
  });
});
