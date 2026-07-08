import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { TranslocoService } from '@jsverse/transloco';
import { RxStomp, RxStompState } from '@stomp/rx-stomp';
import { Subject } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import { ToastService } from '../toast/toast.service';
import { UndoRedoService } from './undo-redo.service';
import { WhiteboardSyncService } from './whiteboard-sync.service';

// `RxStompState` is a plain 4-value enum (CONNECTING/OPEN/CLOSING/CLOSED) — reconstructed
// here instead of re-exported via `importOriginal` to avoid a module-hoisting TDZ issue
// between this factory and the service's own top-level `@stomp/rx-stomp` import.
vi.mock('@stomp/rx-stomp', () => ({
  RxStomp: vi.fn(),
  RxStompState: { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 },
}));

/** Minimal fake standing in for `@stomp/rx-stomp`'s `RxStomp`, fully test-driven. */
class FakeRxStomp {
  readonly connectionState$ = new Subject<RxStompState>();
  readonly stompErrors$ = new Subject<unknown>();
  readonly configureCalls: unknown[] = [];
  activateCalls = 0;
  deactivateCalls = 0;
  readonly publishCalls: { destination: string; body: string }[] = [];
  private readonly watchers = new Map<string, Subject<{ body: string }>>();

  configure(cfg: unknown): void {
    this.configureCalls.push(cfg);
  }

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
const TOPIC = `/topic/whiteboard/${BOARD_ID}`;
const ERROR_QUEUE = '/user/queue/errors';

describe('WhiteboardSyncService', () => {
  let service: WhiteboardSyncService;
  let fake: FakeRxStomp;
  let toastService: ToastService;
  let router: Router;
  let undoRedo: UndoRedoService;

  beforeEach(() => {
    fake = new FakeRxStomp();
    // A regular function (not an arrow function) is required here: `new RxStomp()` in the
    // service invokes this mock implementation via construction, and arrow functions
    // cannot be used as constructors.
    (RxStomp as unknown as Mock).mockImplementation(function (this: unknown) {
      return fake;
    });

    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: TranslocoService, useValue: { translate: (key: string) => key } },
      ],
    });

    service = TestBed.inject(WhiteboardSyncService);
    toastService = TestBed.inject(ToastService);
    router = TestBed.inject(Router);
    undoRedo = TestBed.inject(UndoRedoService);
    vi.spyOn(toastService, 'show');
    vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
    vi.spyOn(undoRedo, 'reset');
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // ── connect() ──

  it('configures RxStomp with the exponential backoff contract (1s base, 30s cap)', () => {
    service.connect(BOARD_ID);
    const cfg = fake.configureCalls[0] as { reconnectDelay: number; maxReconnectDelay: number };
    expect(cfg.reconnectDelay).toBe(1000);
    expect(cfg.maxReconnectDelay).toBe(30000);
    expect(fake.activateCalls).toBe(1);
  });

  it('starts in the "connecting" status with readOnly true', () => {
    service.connect(BOARD_ID);
    expect(service.status()).toBe('connecting');
    expect(service.readOnly()).toBe(true);
  });

  it('transitions to "open" and clears readOnly once connected', () => {
    service.connect(BOARD_ID);
    fake.connectionState$.next(RxStompState.CONNECTING);
    fake.connectionState$.next(RxStompState.OPEN);
    expect(service.status()).toBe('open');
    expect(service.readOnly()).toBe(false);
  });

  it('does not show the reconnected toast on the very first successful connect', () => {
    service.connect(BOARD_ID);
    fake.connectionState$.next(RxStompState.CONNECTING);
    fake.connectionState$.next(RxStompState.OPEN);
    expect(service.showReconnectedToast()).toBe(false);
  });

  // ── Reconnection / failure sequence (AC4, AC8, AC9, AC10) ──

  it('ignores a CLOSED emission before any CONNECTING (initial BehaviorSubject replay)', () => {
    service.connect(BOARD_ID);
    fake.connectionState$.next(RxStompState.CLOSED);
    expect(service.status()).toBe('connecting');
    expect(fake.deactivateCalls).toBe(0);
  });

  it('moves to "lost" after a connection drop following a successful connect', () => {
    service.connect(BOARD_ID);
    fake.connectionState$.next(RxStompState.CONNECTING);
    fake.connectionState$.next(RxStompState.OPEN);
    fake.connectionState$.next(RxStompState.CLOSED);
    expect(service.status()).toBe('lost');
    expect(service.readOnly()).toBe(true);
  });

  it('shows the "Reconnected" toast for 3s after recovering from a lost connection', () => {
    vi.useFakeTimers();
    service.connect(BOARD_ID);
    fake.connectionState$.next(RxStompState.CONNECTING);
    fake.connectionState$.next(RxStompState.OPEN);
    fake.connectionState$.next(RxStompState.CLOSED);
    fake.connectionState$.next(RxStompState.CONNECTING);
    fake.connectionState$.next(RxStompState.OPEN);

    expect(service.showReconnectedToast()).toBe(true);
    vi.advanceTimersByTime(2999);
    expect(service.showReconnectedToast()).toBe(true);
    vi.advanceTimersByTime(1);
    expect(service.showReconnectedToast()).toBe(false);
  });

  it('gives up after 3 failed connection attempts and stops auto-reconnect', () => {
    service.connect(BOARD_ID);
    fake.connectionState$.next(RxStompState.CONNECTING);
    fake.connectionState$.next(RxStompState.CLOSED); // attempt 1
    expect(service.status()).toBe('lost');
    fake.connectionState$.next(RxStompState.CONNECTING);
    fake.connectionState$.next(RxStompState.CLOSED); // attempt 2
    expect(service.status()).toBe('lost');
    fake.connectionState$.next(RxStompState.CONNECTING);
    fake.connectionState$.next(RxStompState.CLOSED); // attempt 3

    expect(service.status()).toBe('failed');
    expect(fake.deactivateCalls).toBeGreaterThanOrEqual(1);
  });

  it('retryManual() resets the attempt counter and reactivates the client', () => {
    service.connect(BOARD_ID);
    for (let i = 0; i < 3; i++) {
      fake.connectionState$.next(RxStompState.CONNECTING);
      fake.connectionState$.next(RxStompState.CLOSED);
    }
    expect(service.status()).toBe('failed');

    service.retryManual();
    expect(service.status()).toBe('connecting');
    expect(fake.activateCalls).toBe(2);
  });

  it('retryManual() is a no-op before any connect() call', () => {
    service.retryManual();
    expect(fake.activateCalls).toBe(0);
  });

  // ── Offline / online (AC11) ──

  it('reflects the browser offline event and forces read-only, independent of WS status', () => {
    service.connect(BOARD_ID);
    fake.connectionState$.next(RxStompState.CONNECTING);
    fake.connectionState$.next(RxStompState.OPEN);
    expect(service.readOnly()).toBe(false);

    window.dispatchEvent(new Event('offline'));
    expect(service.browserOffline()).toBe(true);
    expect(service.readOnly()).toBe(true);

    window.dispatchEvent(new Event('online'));
    expect(service.browserOffline()).toBe(false);
    expect(service.readOnly()).toBe(false);
  });

  // ── publish / publishDraw (AC2) ──

  it('publishDraw() sends a single DRAW message with a type sub-field, once connected', () => {
    service.connect(BOARD_ID);
    fake.connectionState$.next(RxStompState.CONNECTING);
    fake.connectionState$.next(RxStompState.OPEN);

    service.publishDraw('stroke', { id: 'obj-1', points: [[0, 0]] });

    expect(fake.publishCalls).toHaveLength(1);
    expect(fake.publishCalls[0].destination).toBe(`/app/whiteboard/${BOARD_ID}/action`);
    const body = JSON.parse(fake.publishCalls[0].body);
    expect(body).toEqual({
      type: 'DRAW',
      data: { type: 'stroke', payload: { id: 'obj-1', points: [[0, 0]] } },
    });
  });

  it('publish() never includes a userId/tenantId field in the outgoing payload', () => {
    service.connect(BOARD_ID);
    fake.connectionState$.next(RxStompState.CONNECTING);
    fake.connectionState$.next(RxStompState.OPEN);

    service.publish('UNDO', { eventId: 'evt-1' });

    const body = JSON.parse(fake.publishCalls[0].body);
    expect(body).toEqual({ type: 'UNDO', data: { eventId: 'evt-1' } });
    expect(body.userId).toBeUndefined();
    expect(body.data.userId).toBeUndefined();
  });

  it('publishDraw() is a no-op while not connected (does not silently queue)', () => {
    service.connect(BOARD_ID);
    service.publishDraw('stroke', { id: 'obj-1' });
    expect(fake.publishCalls).toHaveLength(0);
  });

  // ── Incoming message validation (AC3, "messages entrants validés") ──

  it('applies a valid remote DRAW action', () => {
    service.connect(BOARD_ID);
    const received: unknown[] = [];
    service.remoteActions$.subscribe(a => received.push(a));

    fake.emit(
      TOPIC,
      JSON.stringify({
        type: 'DRAW',
        boardId: BOARD_ID,
        userId: 'user-2',
        data: { type: 'shape', payload: { id: 'obj-9' } },
      }),
    );

    expect(received).toEqual([{ type: 'DRAW', subType: 'shape', payload: { id: 'obj-9' } }]);
  });

  it('ignores a message whose boardId does not match the connected board', () => {
    service.connect(BOARD_ID);
    const received: unknown[] = [];
    service.remoteActions$.subscribe(a => received.push(a));

    fake.emit(
      TOPIC,
      JSON.stringify({
        type: 'DRAW',
        boardId: 'some-other-board',
        userId: 'user-2',
        data: { type: 'shape', payload: {} },
      }),
    );

    expect(received).toHaveLength(0);
  });

  it('ignores a non-object payload (e.g. a bare JSON string or number)', () => {
    service.connect(BOARD_ID);
    const received: unknown[] = [];
    service.remoteActions$.subscribe(a => received.push(a));

    fake.emit(TOPIC, JSON.stringify('just a string'));
    fake.emit(TOPIC, JSON.stringify(42));
    fake.emit(TOPIC, JSON.stringify(null));

    expect(received).toHaveLength(0);
  });

  it('ignores an object payload missing the type/boardId fields', () => {
    service.connect(BOARD_ID);
    const received: unknown[] = [];
    service.remoteActions$.subscribe(a => received.push(a));

    fake.emit(TOPIC, JSON.stringify({ data: {} }));

    expect(received).toHaveLength(0);
  });

  it('ignores a message with an unknown top-level type', () => {
    service.connect(BOARD_ID);
    const received: unknown[] = [];
    service.remoteActions$.subscribe(a => received.push(a));

    fake.emit(TOPIC, JSON.stringify({ type: 'HACK', boardId: BOARD_ID, userId: 'u', data: {} }));

    expect(received).toHaveLength(0);
  });

  it('ignores a known non-DRAW type (JOIN/LEAVE/CURSOR_MOVE/UNDO/PARTICIPANTS_UPDATE — out of scope)', () => {
    service.connect(BOARD_ID);
    const received: unknown[] = [];
    service.remoteActions$.subscribe(a => received.push(a));

    fake.emit(TOPIC, JSON.stringify({ type: 'CURSOR_MOVE', boardId: BOARD_ID, userId: 'u', data: { x: 1, y: 2 } }));

    expect(received).toHaveLength(0);
  });

  it('ignores a DRAW message with an unknown sub-type', () => {
    service.connect(BOARD_ID);
    const received: unknown[] = [];
    service.remoteActions$.subscribe(a => received.push(a));

    fake.emit(
      TOPIC,
      JSON.stringify({ type: 'DRAW', boardId: BOARD_ID, userId: 'u', data: { type: 'not-a-real-subtype' } }),
    );

    expect(received).toHaveLength(0);
  });

  it('ignores malformed JSON without throwing', () => {
    service.connect(BOARD_ID);
    const received: unknown[] = [];
    service.remoteActions$.subscribe(a => received.push(a));

    expect(() => fake.emit(TOPIC, '{not valid json')).not.toThrow();
    expect(received).toHaveLength(0);
  });

  // ── Revocation (AC6 — "user révoqué → STOMP ERROR") ──

  it('on a STOMP ERROR frame: toasts, disconnects, and redirects to /whiteboard', () => {
    service.connect(BOARD_ID);
    fake.stompErrors$.next({});

    expect(toastService.show).toHaveBeenCalledWith('whiteboard.ws.revoked', 'error');
    expect(router.navigateByUrl).toHaveBeenCalledWith('/whiteboard');
    expect(fake.deactivateCalls).toBeGreaterThanOrEqual(1);
  });

  it('on an application error delivered to /user/queue/errors: same revoked handling', () => {
    service.connect(BOARD_ID);
    fake.emit(ERROR_QUEUE, JSON.stringify({ error: 'Access denied to board ' + BOARD_ID }));

    expect(toastService.show).toHaveBeenCalledWith('whiteboard.ws.revoked', 'error');
    expect(router.navigateByUrl).toHaveBeenCalledWith('/whiteboard');
  });

  // ── disconnect() ──

  it('disconnect() deactivates the client, clears listeners and resets the undo stack', () => {
    service.connect(BOARD_ID);
    fake.connectionState$.next(RxStompState.CONNECTING);
    fake.connectionState$.next(RxStompState.OPEN);

    service.disconnect();

    expect(fake.deactivateCalls).toBeGreaterThanOrEqual(1);
    expect(undoRedo.reset).toHaveBeenCalled();
  });

  it('disconnect() stops applying subsequent incoming messages', () => {
    service.connect(BOARD_ID);
    const received: unknown[] = [];
    service.remoteActions$.subscribe(a => received.push(a));
    service.disconnect();

    // The underlying fake still exists (module-level object), but the service should have
    // unsubscribed — emitting on it must not reach remoteActions$ any more.
    fake.emit(
      TOPIC,
      JSON.stringify({ type: 'DRAW', boardId: BOARD_ID, userId: 'u', data: { type: 'stroke', payload: {} } }),
    );
    expect(received).toHaveLength(0);
  });

  it('disconnect() is safe to call without a prior connect()', () => {
    expect(() => service.disconnect()).not.toThrow();
    expect(undoRedo.reset).toHaveBeenCalled();
  });
});
