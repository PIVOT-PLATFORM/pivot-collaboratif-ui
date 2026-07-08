import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  HostListener,
  OnDestroy,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { Subscription } from 'rxjs';
import {
  ParticipantInfo,
  RemoteCursorMove,
  WhiteboardSyncService,
} from '../../core/whiteboard/whiteboard-sync.service';

/** Minimum delay between two outgoing `CURSOR_MOVE` STOMP publishes (AC "throttlé à 50ms minimum"). */
const CURSOR_PUBLISH_THROTTLE_MS = 50;
/** A remote cursor disappears after this long without a new `CURSOR_MOVE` (AC "timeout local 5s"). */
const CURSOR_INACTIVITY_TIMEOUT_MS = 5000;

/** A remote cursor as rendered by the overlay — live position merged with participant metadata. */
interface DisplayCursor {
  userId: string;
  x: number;
  y: number;
  displayName: string;
  color: string;
}

/** Internal bookkeeping for one tracked remote cursor (position + its inactivity timer). */
interface CursorEntry {
  x: number;
  y: number;
  timeoutId: ReturnType<typeof setTimeout>;
}

/**
 * SVG overlay rendering other participants' live cursors on top of the whiteboard canvas
 * (US08.3.2c). Meant to be projected into `WhiteboardCanvasComponent`'s `wb-canvas-area`
 * slot (via `<ng-content>`) so its `position: absolute; inset: 0` host exactly matches the
 * canvas element's own bounds — see `whiteboard-canvas.component.html`.
 *
 * ## Architectural decision — not STOMP-unaware, unlike WhiteboardCanvasComponent
 * `WhiteboardCanvasComponent` is deliberately kept transport-agnostic (`drawAction`/`undoAction`
 * outputs, with `WhiteboardBoardComponent` doing the STOMP wiring) so it can be exercised or
 * reused without any real-time dependency. A presence overlay has no such reuse case — it
 * exists only to visualise the presence wire contract — so this component injects
 * {@link WhiteboardSyncService} directly rather than routing `CURSOR_MOVE`/`PARTICIPANTS_UPDATE`
 * through `WhiteboardBoardComponent` as extra glue. This halves the plumbing for a feature that
 * is inherently about the transport, at no real cost to testability (the service is itself
 * already unit-tested against a fake `RxStomp`; this component's own spec substitutes a
 * lightweight stub for it).
 *
 * ## Throttle placement
 * The outgoing-publish throttle lives here (not in `WhiteboardSyncService.publish`) so it is
 * directly observable by this component's own Vitest suite (Gate 2 explicitly requires a
 * "throttle" test on `WhiteboardPresenceComponent`) — a leading-edge throttle: the first
 * pointer move after {@link CURSOR_PUBLISH_THROTTLE_MS} of silence is sent immediately,
 * subsequent moves within that window are dropped (not queued/coalesced), matching the AC's
 * literal wording "throttlé à 50ms minimum avant envoi STOMP".
 *
 * ## Coordinate space — known, documented simplification
 * `x`/`y` are captured relative to this component's own host bounding rect (which mirrors the
 * canvas element's rect via CSS, see class doc above) — i.e. raw canvas-viewport pixels,
 * **not** compensated for each viewer's local zoom/pan (`WhiteboardCanvasComponent.zoom`/
 * `panX`/`panY` are private, internal-only state, not exposed for cross-component reuse today).
 * Two participants with different local zoom/pan will see each other's cursor at a visually
 * different spot relative to the drawn content, though both still see it move in real time.
 * Not covered by any AC in this US (no multi-viewport pixel-perfect alignment requirement) —
 * documented here as a deliberate, time-boxed scope decision rather than an oversight; a
 * future US could align this with `WhiteboardCanvasComponent`'s world-space transform if needed.
 */
@Component({
  selector: 'app-whiteboard-presence',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslocoPipe],
  templateUrl: './whiteboard-presence.component.html',
  styleUrl: './whiteboard-presence.component.scss',
})
export class WhiteboardPresenceComponent implements OnInit, OnDestroy {
  private readonly sync = inject(WhiteboardSyncService);
  private readonly elementRef = inject(ElementRef<HTMLElement>);

  private readonly participants = signal<ReadonlyMap<string, ParticipantInfo>>(new Map());
  private readonly cursors = signal<ReadonlyMap<string, CursorEntry>>(new Map());

  /** Cursors ready for template rendering — live position merged with participant metadata. */
  protected readonly visibleCursors = computed<DisplayCursor[]>(() => {
    const participants = this.participants();
    const result: DisplayCursor[] = [];
    for (const [userId, entry] of this.cursors()) {
      const info = participants.get(userId);
      if (!info) {
        continue;
      }
      result.push({ userId, x: entry.x, y: entry.y, displayName: info.displayName, color: info.color });
    }
    return result;
  });

  private cursorMovesSubscription?: Subscription;
  private participantsSubscription?: Subscription;
  private lastPublishedAt = 0;

  ngOnInit(): void {
    this.cursorMovesSubscription = this.sync.cursorMoves$.subscribe(move => this.applyCursorMove(move));
    this.participantsSubscription = this.sync.participantsUpdates$.subscribe(list =>
      this.applyParticipantsUpdate(list),
    );
  }

  ngOnDestroy(): void {
    this.cursorMovesSubscription?.unsubscribe();
    this.participantsSubscription?.unsubscribe();
    for (const entry of this.cursors().values()) {
      clearTimeout(entry.timeoutId);
    }
  }

  /**
   * Captures the local pointer position over the canvas area and publishes it as
   * `CURSOR_MOVE` (throttled, see class TSDoc). Listens at `window` level — this component's
   * own host stays `pointer-events: none` (decorative overlay, never intercepts drawing input
   * meant for the canvas below it) — and bounds the position to this host's own rect, so
   * pointer activity elsewhere on the page (toolbar, dialogs, …) is ignored.
   *
   * @param event the raw browser pointer move event
   */
  @HostListener('window:pointermove', ['$event'])
  protected onWindowPointerMove(event: PointerEvent): void {
    const rect = this.elementRef.nativeElement.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    if (x < 0 || y < 0 || x > rect.width || y > rect.height) {
      return;
    }
    const now = Date.now();
    if (now - this.lastPublishedAt < CURSOR_PUBLISH_THROTTLE_MS) {
      return;
    }
    this.lastPublishedAt = now;
    this.sync.publish('CURSOR_MOVE', { x, y });
  }

  /**
   * Applies a validated remote `CURSOR_MOVE` (called on every
   * {@link WhiteboardSyncService.cursorMoves$} emission). A `CURSOR_MOVE` for a `userId` with
   * no prior `JOIN` — i.e. absent from the last `PARTICIPANTS_UPDATE` — is an inconsistent
   * state (e.g. a message that arrives late after a reconnection race) and is ignored rather
   * than rendered as a phantom cursor (AC).
   *
   * @param move the validated `{ userId, x, y }` broadcast
   */
  private applyCursorMove(move: RemoteCursorMove): void {
    if (!this.participants().has(move.userId)) {
      console.warn(
        `[WhiteboardPresenceComponent] CURSOR_MOVE for unknown participant "${move.userId}" ignored (no prior JOIN)`,
      );
      return;
    }
    const next = new Map(this.cursors());
    const existing = next.get(move.userId);
    if (existing) {
      clearTimeout(existing.timeoutId);
    }
    const timeoutId = setTimeout(() => this.expireCursor(move.userId), CURSOR_INACTIVITY_TIMEOUT_MS);
    next.set(move.userId, { x: move.x, y: move.y, timeoutId });
    this.cursors.set(next);
  }

  /** Removes a cursor after {@link CURSOR_INACTIVITY_TIMEOUT_MS} of inactivity (AC). */
  private expireCursor(userId: string): void {
    const next = new Map(this.cursors());
    if (next.delete(userId)) {
      this.cursors.set(next);
    }
  }

  /**
   * Applies a validated `PARTICIPANTS_UPDATE` — replaces the known participant set and
   * immediately removes the cursor of any participant no longer present (AC "participant
   * déconnecté → curseur retiré immédiatement"), independent of the 5s inactivity timeout.
   *
   * @param list the full current participant list from the broadcast
   */
  private applyParticipantsUpdate(list: ParticipantInfo[]): void {
    const map = new Map(list.map(p => [p.userId, p] as const));
    this.participants.set(map);

    const next = new Map(this.cursors());
    let changed = false;
    for (const [userId, entry] of next) {
      if (!map.has(userId)) {
        clearTimeout(entry.timeoutId);
        next.delete(userId);
        changed = true;
      }
    }
    if (changed) {
      this.cursors.set(next);
    }
  }
}
