import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { TranslocoService } from '@jsverse/transloco';
import { RxStomp, RxStompState } from '@stomp/rx-stomp';
import { Subject } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import { WhiteboardSyncService, type ParticipantInfo } from '../whiteboard-sync.service';
import { COLLABORATIF_API_URL, COLLABORATIF_BEARER_TOKEN } from '../config/tokens';
import participantsUpdateFixtureJson from './participants-update.json';

/**
 * EN08.5 — Couche 2 (forme de payload), volet `participants-update.json`.
 *
 * `participants-update.json` documents the backend's `PARTICIPANTS_UPDATE` broadcast on the
 * board's dedicated `/topic/whiteboard/{boardId}/presence` subtopic — a raw, non-enveloped
 * `{participants:[...]}` object (see `WhiteboardSyncService`'s class TSDoc, "Presence topic").
 * This is a DIFFERENT consumer from `BoardStore`'s `board:presence`/`PresenceUser[]` (see
 * `board.store.payload-shapes.spec.ts`'s header comment for why that one is out of scope here):
 * `WhiteboardSyncService.onPresenceIncoming` → `participantsUpdates$` is the real, existing
 * consumer of exactly this fixture's shape (`ParticipantInfo`), so it is exercised directly
 * against the committed fixture bytes rather than a hand-rolled object.
 *
 * `vi.mock('@stomp/rx-stomp', …)` is file-scoped (hoisted) — this spec gets its own copy rather
 * than sharing `whiteboard-sync.service.spec.ts`'s, per the established convention in this
 * folder of keeping module-mock state isolated per spec file (see `board-transport.spec.ts`).
 */
vi.mock('@stomp/rx-stomp', () => ({
  RxStomp: vi.fn(),
  RxStompState: { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 },
}));

/** Minimal fake standing in for `@stomp/rx-stomp`'s `RxStomp`, driven directly by the test. */
class FakeRxStomp {
  readonly connectionState$ = new Subject<RxStompState>();
  readonly stompErrors$ = new Subject<unknown>();
  private readonly watchers = new Map<string, Subject<{ body: string }>>();

  configure(): void {}
  activate(): void {}
  deactivate(): Promise<void> {
    return Promise.resolve();
  }
  publish(): void {}

  watch(destination: string) {
    return this.watcher(destination).asObservable();
  }

  emit(destination: string, body: string): void {
    this.watcher(destination).next({ body });
  }

  private watcher(destination: string): Subject<{ body: string }> {
    let subject = this.watchers.get(destination);
    if (!subject) {
      subject = new Subject<{ body: string }>();
      this.watchers.set(destination, subject);
    }
    return subject;
  }
}

const BOARD_ID = 'board-abc';
const PRESENCE_TOPIC = `/topic/whiteboard/${BOARD_ID}/presence`;

function loadFixture(): { participants: ParticipantInfo[] } {
  return participantsUpdateFixtureJson as { participants: ParticipantInfo[] };
}

describe('WhiteboardSyncService presence reconciliation vs. canonical participants-update.json (EN08.5, Couche 2)', () => {
  let service: WhiteboardSyncService;
  let fake: FakeRxStomp;

  beforeEach(() => {
    fake = new FakeRxStomp();
    (RxStomp as unknown as Mock).mockImplementation(function (this: unknown) {
      return fake;
    });

    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: TranslocoService, useValue: { translate: (key: string) => key } },
        { provide: COLLABORATIF_API_URL, useValue: 'http://localhost:8083/api/collaboratif' },
        { provide: COLLABORATIF_BEARER_TOKEN, useValue: (): string | null => null },
      ],
    });

    service = TestBed.inject(WhiteboardSyncService);
    // Silence the router navigation this service performs on some unrelated error paths — not
    // under test here, but constructed eagerly by TestBed.inject.
    TestBed.inject(Router);
  });

  it('parses the fixture\'s two participants with every field exactly named and typed', () => {
    service.connect(BOARD_ID);
    const fixture = loadFixture();
    const updates: ParticipantInfo[][] = [];
    service.participantsUpdates$.subscribe((p) => updates.push(p));

    fake.emit(PRESENCE_TOPIC, JSON.stringify(fixture));

    expect(updates).toHaveLength(1);
    expect(updates[0]).toEqual(fixture.participants);
  });

  it('preserves a null avatarUrl verbatim (fixture\'s second participant)', () => {
    service.connect(BOARD_ID);
    const fixture = loadFixture();
    const updates: ParticipantInfo[][] = [];
    service.participantsUpdates$.subscribe((p) => updates.push(p));

    fake.emit(PRESENCE_TOPIC, JSON.stringify(fixture));

    const grace = updates[0].find((p) => p.userId === '1002');
    expect(grace).toMatchObject({ displayName: 'Grace Hopper', avatarUrl: null, role: 'VIEWER' });
  });

  it('preserves the exact role casing from the fixture ("EDITOR"/"VIEWER", not lowercased)', () => {
    service.connect(BOARD_ID);
    const fixture = loadFixture();
    const updates: ParticipantInfo[][] = [];
    service.participantsUpdates$.subscribe((p) => updates.push(p));

    fake.emit(PRESENCE_TOPIC, JSON.stringify(fixture));

    const ada = updates[0].find((p) => p.userId === '1001');
    expect(ada?.role).toBe('EDITOR');
  });
});
