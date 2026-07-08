import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslocoTestingModule } from '@jsverse/transloco';
import { Subject } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ParticipantInfo,
  RemoteCursorMove,
  WhiteboardSyncService,
} from '../../core/whiteboard/whiteboard-sync.service';
import { WhiteboardPresenceComponent } from './whiteboard-presence.component';

/**
 * Lightweight stand-in for `WhiteboardSyncService` — exposes only the public surface this
 * component depends on (`cursorMoves$`/`participantsUpdates$`/`publish`), without the real
 * service's STOMP/Router/Toast wiring (already covered in its own dedicated spec file).
 */
class FakeSyncService {
  readonly cursorMoves$ = new Subject<RemoteCursorMove>();
  readonly participantsUpdates$ = new Subject<ParticipantInfo[]>();
  readonly publishCalls: { type: string; data: Record<string, unknown> }[] = [];

  publish(type: string, data: Record<string, unknown>): void {
    this.publishCalls.push({ type, data });
  }
}

const ALICE: ParticipantInfo = {
  userId: 'u1',
  displayName: 'Alice',
  avatarUrl: null,
  color: '#E91E63',
  role: 'EDITOR',
};
const BOB: ParticipantInfo = {
  userId: 'u2',
  displayName: 'Bob',
  avatarUrl: null,
  color: '#2196F3',
  role: 'VIEWER',
};

describe('WhiteboardPresenceComponent', () => {
  let fixture: ComponentFixture<WhiteboardPresenceComponent>;
  let sync: FakeSyncService;

  beforeEach(async () => {
    sync = new FakeSyncService();

    await TestBed.configureTestingModule({
      imports: [
        WhiteboardPresenceComponent,
        TranslocoTestingModule.forRoot({
          langs: { fr: {}, en: {} },
          translocoConfig: { defaultLang: 'fr', availableLangs: ['fr', 'en'] },
          preloadLangs: true,
        }),
      ],
      providers: [{ provide: WhiteboardSyncService, useValue: sync }],
    }).compileComponents();

    fixture = TestBed.createComponent(WhiteboardPresenceComponent);
    fixture.nativeElement.getBoundingClientRect = vi.fn().mockReturnValue({
      left: 0,
      top: 0,
      width: 800,
      height: 600,
      right: 800,
      bottom: 600,
    });
    fixture.detectChanges();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function join(...infos: ParticipantInfo[]): void {
    sync.participantsUpdates$.next(infos);
  }

  function move(userId: string, x: number, y: number): void {
    sync.cursorMoves$.next({ userId, x, y });
  }

  function cursors(): NodeListOf<Element> {
    return fixture.nativeElement.querySelectorAll('.wb-presence-cursor');
  }

  // ── Overlay rendering ──

  it('renders a decorative, aria-hidden SVG overlay', () => {
    const svg = fixture.nativeElement.querySelector('svg.wb-presence-overlay');
    expect(svg).not.toBeNull();
    expect(svg.getAttribute('aria-hidden')).toBe('true');
  });

  it('renders no cursor initially (no participants, no CURSOR_MOVE yet)', () => {
    expect(cursors()).toHaveLength(0);
  });

  it('renders a cursor for a known participant after JOIN + CURSOR_MOVE', () => {
    join(ALICE);
    move('u1', 100, 200);
    fixture.detectChanges();

    expect(cursors()).toHaveLength(1);
    expect(cursors()[0].getAttribute('transform')).toBe('translate(100,200)');
    expect(cursors()[0].querySelector('.wb-presence-cursor__label')?.textContent?.trim()).toBe('Alice');
  });

  it('renders multiple simultaneous cursors, each with its own colour', () => {
    join(ALICE, BOB);
    move('u1', 10, 10);
    move('u2', 20, 20);
    fixture.detectChanges();

    expect(cursors()).toHaveLength(2);
    const paths = fixture.nativeElement.querySelectorAll('.wb-presence-cursor__pointer');
    const fills = Array.from(paths as NodeListOf<Element>).map(p => p.getAttribute('fill'));
    expect(fills).toEqual(expect.arrayContaining(['#E91E63', '#2196F3']));
  });

  it('renders the displayName as escaped text — never as markup (XSS, security AC)', () => {
    join({ ...ALICE, displayName: '<img src=x onerror=alert(1)>' });
    move('u1', 5, 5);
    fixture.detectChanges();

    const label = fixture.nativeElement.querySelector('.wb-presence-cursor__label') as HTMLElement;
    expect(label.querySelector('img')).toBeNull();
    expect(label.textContent).toContain('<img src=x onerror=alert(1)>');
  });

  // ── CURSOR_MOVE without prior JOIN (AC) ──

  it('ignores a CURSOR_MOVE for a userId with no prior JOIN — logs a warning, no phantom cursor', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    move('ghost', 1, 1);
    fixture.detectChanges();

    expect(cursors()).toHaveLength(0);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toContain('ghost');
  });

  // ── Participant disconnect removes cursor immediately (AC) ──

  it('removes a cursor immediately when PARTICIPANTS_UPDATE no longer includes that userId', () => {
    join(ALICE, BOB);
    move('u1', 1, 1);
    move('u2', 2, 2);
    fixture.detectChanges();
    expect(cursors()).toHaveLength(2);

    join(ALICE); // BOB left the board
    fixture.detectChanges();

    expect(cursors()).toHaveLength(1);
    expect(cursors()[0].querySelector('.wb-presence-cursor__label')?.textContent?.trim()).toBe('Alice');
  });

  // ── Inactivity timeout — 5s local timeout (AC) ──

  it('removes a cursor after 5s without a new CURSOR_MOVE', () => {
    vi.useFakeTimers();
    join(ALICE);
    move('u1', 1, 1);
    fixture.detectChanges();
    expect(cursors()).toHaveLength(1);

    vi.advanceTimersByTime(4999);
    fixture.detectChanges();
    expect(cursors()).toHaveLength(1);

    vi.advanceTimersByTime(1);
    fixture.detectChanges();
    expect(cursors()).toHaveLength(0);
  });

  it('a fresh CURSOR_MOVE resets the 5s inactivity timer', () => {
    vi.useFakeTimers();
    join(ALICE);
    move('u1', 1, 1);

    vi.advanceTimersByTime(4000);
    move('u1', 2, 2); // resets the window
    vi.advanceTimersByTime(4000);
    fixture.detectChanges();
    expect(cursors()).toHaveLength(1);

    vi.advanceTimersByTime(1000);
    fixture.detectChanges();
    expect(cursors()).toHaveLength(0);
  });

  // ── Outgoing throttle — 50ms minimum before STOMP publish (AC) ──

  it('publishes a local CURSOR_MOVE on the first pointer move over the overlay', () => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);

    window.dispatchEvent(new PointerEvent('pointermove', { clientX: 50, clientY: 60 }));

    expect(sync.publishCalls).toEqual([{ type: 'CURSOR_MOVE', data: { x: 50, y: 60 } }]);
  });

  it('throttles subsequent local pointer moves to at most one publish per 50ms', () => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);

    window.dispatchEvent(new PointerEvent('pointermove', { clientX: 1, clientY: 1 }));
    window.dispatchEvent(new PointerEvent('pointermove', { clientX: 2, clientY: 2 }));
    window.dispatchEvent(new PointerEvent('pointermove', { clientX: 3, clientY: 3 }));
    expect(sync.publishCalls).toHaveLength(1);

    vi.setSystemTime(10_049);
    window.dispatchEvent(new PointerEvent('pointermove', { clientX: 4, clientY: 4 }));
    expect(sync.publishCalls).toHaveLength(1); // still inside the 50ms window

    vi.setSystemTime(10_050);
    window.dispatchEvent(new PointerEvent('pointermove', { clientX: 5, clientY: 5 }));
    expect(sync.publishCalls).toHaveLength(2);
  });

  it('ignores a pointer move outside the overlay bounds (e.g. over the toolbar)', () => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);

    window.dispatchEvent(new PointerEvent('pointermove', { clientX: -5, clientY: 10 }));
    window.dispatchEvent(new PointerEvent('pointermove', { clientX: 900, clientY: 10 }));

    expect(sync.publishCalls).toHaveLength(0);
  });

  // ── Cleanup ──

  it('unsubscribes and clears pending inactivity timers on destroy', () => {
    vi.useFakeTimers();
    join(ALICE);
    move('u1', 1, 1);

    fixture.destroy();

    // No error/no leaked timer callback mutating a destroyed component's state.
    expect(() => vi.advanceTimersByTime(10_000)).not.toThrow();
  });
});
