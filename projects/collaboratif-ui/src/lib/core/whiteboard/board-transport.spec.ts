import { TestBed } from '@angular/core/testing';
import { RxStomp } from '@stomp/rx-stomp';
import { Subject } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import { StompBoardTransport } from './board-transport';
import { COLLABORATIF_API_URL, COLLABORATIF_BEARER_TOKEN } from './config/tokens';

const TEST_API_URL = 'http://localhost:8083/api/collaboratif';
const BOARD_ID = 'board-abc';

// Mocked so `new RxStomp()` inside StompBoardTransport#connect returns our FakeRxStomp instead
// of opening a real WebSocket — same technique as whiteboard-sync.service.spec.ts.
vi.mock('@stomp/rx-stomp', () => ({
  RxStomp: vi.fn(),
}));

/** Minimal fake standing in for `@stomp/rx-stomp`'s `RxStomp`, fully test-driven. */
class FakeRxStomp {
  readonly connected$ = new Subject<void>();
  readonly publishCalls: { destination: string; body: string }[] = [];
  activateCalls = 0;
  deactivateCalls = 0;

  configure(): void {}
  activate(): void {
    this.activateCalls++;
  }
  deactivate(): Promise<void> {
    this.deactivateCalls++;
    return Promise.resolve();
  }
  publish(params: { destination: string; body: string }): void {
    this.publishCalls.push(params);
  }
  watch() {
    return new Subject().asObservable();
  }
}

describe('StompBoardTransport — sender tagging on card:move/card:resize (fix/EN08.4)', () => {
  let transport: StompBoardTransport;
  let fake: FakeRxStomp;

  beforeEach(() => {
    fake = new FakeRxStomp();
    (RxStomp as unknown as Mock).mockImplementation(function (this: unknown) {
      return fake;
    });

    TestBed.configureTestingModule({
      providers: [
        StompBoardTransport,
        { provide: COLLABORATIF_API_URL, useValue: TEST_API_URL },
        { provide: COLLABORATIF_BEARER_TOKEN, useValue: (): string | null => null },
      ],
    });
    transport = TestBed.inject(StompBoardTransport);
    transport.connect(BOARD_ID);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function lastPublishedData(): Record<string, unknown> {
    const body = fake.publishCalls[fake.publishCalls.length - 1].body;
    return (JSON.parse(body) as { data: Record<string, unknown> }).data;
  }

  it('exposes a stable, non-empty session id for the lifetime of the instance', () => {
    const id = transport.getSessionId();
    expect(id).toBeTruthy();
    expect(transport.getSessionId()).toBe(id);
  });

  it('two transport instances get different session ids', () => {
    // A fresh instance constructed in the injection context (mirroring the per-board-container
    // provider scope BoardTransport actually gets — see board.store.ts's class TSDoc) must not
    // collide with the one already injected in beforeEach.
    const second = TestBed.runInInjectionContext(() => new StompBoardTransport());
    expect(second.getSessionId()).not.toBe(transport.getSessionId());
  });

  it('tags card:move with senderSessionId equal to getSessionId()', () => {
    transport.emit('card:move', { id: 'card-1', boardId: BOARD_ID, posX: 10, posY: 20 });

    const data = lastPublishedData();
    expect(data['senderSessionId']).toBe(transport.getSessionId());
    expect(data['posX']).toBe(10);
    expect(data['posY']).toBe(20);
  });

  it('tags card:resize with senderSessionId equal to getSessionId()', () => {
    transport.emit('card:resize', { id: 'card-1', boardId: BOARD_ID, width: 300, height: 200 });

    const data = lastPublishedData();
    expect(data['senderSessionId']).toBe(transport.getSessionId());
    expect(data['width']).toBe(300);
  });

  it('does not tag other action types (e.g. card:create)', () => {
    transport.emit('card:create', { boardId: BOARD_ID, content: 'hi' });

    const data = lastPublishedData();
    expect(data).not.toHaveProperty('senderSessionId');
  });

  it('does not tag board:join, whose data is a bare string, not an object', () => {
    transport.emit('board:join', BOARD_ID);

    const body = fake.publishCalls[fake.publishCalls.length - 1].body;
    const parsed = JSON.parse(body) as { data: unknown };
    expect(parsed.data).toBe(BOARD_ID);
  });
});
