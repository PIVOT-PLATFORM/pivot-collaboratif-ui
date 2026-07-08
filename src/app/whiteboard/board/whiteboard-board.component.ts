import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  ViewChild,
  inject,
} from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { Subscription } from 'rxjs';
import { WhiteboardSyncService } from '../../core/whiteboard/whiteboard-sync.service';
import { DrawAction, UndoEvent, WhiteboardCanvasComponent } from '../canvas/whiteboard-canvas.component';
import { WhiteboardPresenceComponent } from '../presence/whiteboard-presence.component';

/**
 * Route-level container for a single board (`/whiteboard/{boardId}`, US08.3.2b).
 *
 * Owns the {@link WhiteboardSyncService} lifecycle (connect on init, disconnect on
 * destroy) and renders the connection-state banners/toast (AC7-11) around the local
 * `WhiteboardCanvasComponent` (US08.3.2a), which stays STOMP-unaware by design. Bridges
 * the two: canvas `drawAction` outputs are published over STOMP, validated remote
 * actions are applied back onto the canvas via {@link WhiteboardCanvasComponent.applyRemoteAction},
 * and canvas `undoAction` outputs are relayed as `UNDO { eventId }` (US08.3.3 AC5).
 *
 * Board membership is already verified by `boardAccessGuard` before this component is
 * ever activated (route `canActivate`); this component does not repeat that HTTP call —
 * only reconnect-time re-verification happens, and it is entirely server-side (STOMP
 * SUBSCRIBE authorisation, US08.3.1), surfaced here only through {@link WhiteboardSyncService}
 * revocation handling.
 */
@Component({
  selector: 'app-whiteboard-board',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslocoPipe, WhiteboardCanvasComponent, WhiteboardPresenceComponent],
  templateUrl: './whiteboard-board.component.html',
  styleUrl: './whiteboard-board.component.scss',
})
export class WhiteboardBoardComponent implements AfterViewInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly sync = inject(WhiteboardSyncService);

  // Queried by template reference (not by class token) so that tests can substitute a
  // stub for `WhiteboardCanvasComponent` via `overrideComponent` — a class-token query
  // would not resolve against a different component class rendered at the same selector.
  @ViewChild('canvas') private canvasComponent?: WhiteboardCanvasComponent;

  private remoteActionsSubscription?: Subscription;

  /** Board UUID from the route (already validated by `boardAccessGuard`). */
  protected readonly boardId = this.route.snapshot.paramMap.get('boardId') ?? '';

  protected readonly status = this.sync.status;
  protected readonly readOnly = this.sync.readOnly;
  protected readonly browserOffline = this.sync.browserOffline;
  protected readonly showReconnectedToast = this.sync.showReconnectedToast;

  ngAfterViewInit(): void {
    // Subscribed after the view is initialised so `canvasComponent` is guaranteed to be
    // resolved before any remote action could realistically arrive (WS connect + first
    // broadcast always takes at least one network round trip).
    this.remoteActionsSubscription = this.sync.remoteActions$.subscribe(action => {
      this.canvasComponent?.applyRemoteAction(action);
    });
    this.sync.connect(this.boardId);
  }

  ngOnDestroy(): void {
    this.remoteActionsSubscription?.unsubscribe();
    this.sync.disconnect();
  }

  /** Publishes a local canvas action emitted by `WhiteboardCanvasComponent` (AC2). */
  protected onDrawAction(action: DrawAction): void {
    this.sync.publishDraw(action.subType, action.payload);
  }

  /**
   * Relays a local undo as `UNDO { eventId }` over STOMP (US08.3.3 AC5). Uses the same
   * generic {@link WhiteboardSyncService.publish} entry point as `DRAW` — no-op while
   * disconnected (never silently queues), and rejected server-side with a 403-equivalent
   * STOMP application error for a `VIEWER` (`CanvasActionService`, US08.3.1) without any
   * duplicated role check here (AC9).
   */
  protected onUndoAction(action: UndoEvent): void {
    this.sync.publish('UNDO', { eventId: action.eventId });
  }

  /** Wired to the "Réessayer manuellement" button shown after 3 failed attempts (AC10). */
  protected onRetry(): void {
    this.sync.retryManual();
  }
}
