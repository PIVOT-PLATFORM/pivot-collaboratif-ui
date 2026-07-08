import { Injectable, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { TranslocoService } from '@jsverse/transloco';
import { RxStomp, RxStompState } from '@stomp/rx-stomp';
import { ReconnectionTimeMode } from '@stomp/stompjs';
import { Subject, Subscription } from 'rxjs';
import { environment } from '../../../environments/environment';
import { ToastService } from '../toast/toast.service';
import { UndoRedoService } from './undo-redo.service';

/** Sub-type of a `DRAW` STOMP action (contract fixed by US08.3.1/EN08.1). */
export type DrawSubType = 'stroke' | 'shape' | 'erase' | 'move' | 'resize' | 'text';

/**
 * A `DRAW` action exchanged between {@link WhiteboardSyncService} and
 * `WhiteboardCanvasComponent` (matches that component's own `DrawAction` shape —
 * duplicated here rather than imported to keep this core service independent from the
 * `whiteboard/` feature folder, per the layering already used across this repo).
 */
export interface SyncDrawAction {
  type: 'DRAW';
  subType: DrawSubType;
  payload: unknown;
}

/** UI connection status driving banners/toasts in the whiteboard page (US08.3.2b AC7-10). */
export type WhiteboardConnectionStatus = 'connecting' | 'open' | 'lost' | 'failed';

/** Whitelisted top-level STOMP action types (contract fixed by US08.3.1). */
const KNOWN_ACTION_TYPES = new Set([
  'JOIN',
  'LEAVE',
  'DRAW',
  'CURSOR_MOVE',
  'UNDO',
  'PARTICIPANTS_UPDATE',
]);

/** Whitelisted `DRAW` sub-types (contract fixed by US08.3.1/US08.3.2a). */
const KNOWN_DRAW_SUBTYPES = new Set<string>([
  'stroke',
  'shape',
  'erase',
  'move',
  'resize',
  'text',
]);

/** Base reconnect delay — first retry after 1 s (AC4). */
const RECONNECT_BASE_DELAY_MS = 1000;
/** Reconnect delay ceiling — capped at 30 s (AC4). */
const RECONNECT_MAX_DELAY_MS = 30000;
/**
 * Maximum number of connection attempts (the initial attempt plus automatic retries)
 * before giving up and requiring a manual retry (AC10). Documented interpretation
 * (Gate 1 clarification, no prior decision in the backlog file to reuse): "3 tentatives"
 * is read as 3 total connection attempts, matching the AC wording literally. The
 * exponential backoff curve itself (1s/2s/4s/.../max 30s) is configured and verified
 * independently of this cutoff — with only 3 attempts allowed, the 4s/30s tiers of the
 * curve are only exercised if the user triggers a manual retry that itself fails again.
 */
const MAX_RECONNECT_ATTEMPTS = 3;
/** Duration the "Reconnected" toast stays visible (AC9). */
const RECONNECTED_TOAST_DURATION_MS = 3000;
/**
 * Client heartbeat tolerance, aligned with the server's heartbeat contract
 * (`WebSocketConfig`: ping every 25 s, 30 s timeout — US08.3.1).
 */
const HEARTBEAT_INCOMING_MS = 30000;
/** Client outgoing heartbeat interval. */
const HEARTBEAT_OUTGOING_MS = 10000;

/**
 * STOMP synchronisation service for the whiteboard canvas (US08.3.2b).
 *
 * Owns the `@stomp/rx-stomp` client lifecycle for a single board room: connects to
 * `/topic/whiteboard/{boardId}`, publishes local `DRAW` actions to
 * `/app/whiteboard/{boardId}/action`, and exposes the connection status consumed by
 * `WhiteboardBoardComponent` for the connecting/lost/reconnected/failed/offline UI
 * states (AC7-11).
 *
 * ## Wire contract (fixed by US08.3.1, already merged server-side)
 * Outgoing frames are `{ type: 'DRAW', data: { type: subType, payload } }` — a single
 * STOMP message type (`DRAW`) with a `type` sub-field, never a distinct STOMP type per
 * canvas action (crayon/forme/effacement/déplacement/redimensionnement). Incoming
 * broadcasts are `{ type, boardId, userId, data }` (`BroadcastCanvasMessage`); `userId`
 * is resolved server-side from the authenticated STOMP principal and is never trusted
 * from the client payload (CLAUDE.md: no client-supplied `userId`/`tenantId` in body).
 *
 * ## Generic publish API (for US08.3.3)
 * {@link publish} is intentionally generic (`type` + `data`) so that the future
 * undo/redo US can relay an `UNDO { eventId }` message through this same service without
 * requiring a refactor. This service does not implement undo/redo logic itself.
 *
 * ## Known platform gap — WS handshake identity
 * The backend's `StompHandshakeInterceptor` reads caller identity from the
 * `X-Pivot-User-Id`/`X-Pivot-Tenant-Id` **HTTP** headers on the WebSocket upgrade
 * request. Browsers cannot set custom headers on a native `WebSocket` handshake, so — like
 * every other part of this bootstrap repo (see CLAUDE.md, "Auth différée") — real
 * end-to-end connection is blocked on EN17 (`pivot-core-starter`) publishing a proper
 * opaque-token mechanism. This service is built to the contract as merged; it does not
 * attempt to work around the missing auth glue.
 */
@Injectable({ providedIn: 'root' })
export class WhiteboardSyncService {
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  private readonly transloco = inject(TranslocoService);
  private readonly undoRedo = inject(UndoRedoService);

  /** Current WS connection status — drives the connecting/lost/failed banners. */
  readonly status = signal<WhiteboardConnectionStatus>('connecting');
  /** True for {@link RECONNECTED_TOAST_DURATION_MS} right after a successful reconnect (AC9). */
  readonly showReconnectedToast = signal(false);
  /** True while the browser reports itself offline (`window` `online`/`offline` events, AC11). */
  readonly browserOffline = signal(false);
  /** Canvas must be read-only unless fully connected and the browser is online. */
  readonly readOnly = computed(() => this.status() !== 'open' || this.browserOffline());

  /** Emits validated remote `DRAW` actions for the canvas to apply (AC3). */
  readonly remoteActions$ = new Subject<SyncDrawAction>();

  private rxStomp: RxStomp | null = null;
  private boardId: string | null = null;
  private topicSubscription: Subscription | null = null;
  private errorQueueSubscription: Subscription | null = null;
  private stateSubscription: Subscription | null = null;
  private stompErrorSubscription: Subscription | null = null;
  private attempts = 0;
  private everConnecting = false;
  private hasConnectedOnce = false;
  private reconnectedToastTimer: ReturnType<typeof setTimeout> | null = null;

  private readonly onlineListener = (): void => this.browserOffline.set(false);
  private readonly offlineListener = (): void => this.browserOffline.set(true);

  /**
   * Connects to the given board's STOMP room. Safe to call once per board navigation;
   * call {@link disconnect} first if switching boards on the same component instance.
   *
   * @param boardId the board UUID (already access-checked by `boardAccessGuard`)
   */
  connect(boardId: string): void {
    this.boardId = boardId;
    this.attempts = 0;
    this.everConnecting = false;
    this.hasConnectedOnce = false;
    this.status.set('connecting');
    this.browserOffline.set(!navigator.onLine);

    window.addEventListener('online', this.onlineListener);
    window.addEventListener('offline', this.offlineListener);

    const rxStomp = new RxStomp();
    rxStomp.configure({
      brokerURL: this.buildWsUrl(),
      reconnectDelay: RECONNECT_BASE_DELAY_MS,
      maxReconnectDelay: RECONNECT_MAX_DELAY_MS,
      reconnectTimeMode: ReconnectionTimeMode.EXPONENTIAL,
      heartbeatIncoming: HEARTBEAT_INCOMING_MS,
      heartbeatOutgoing: HEARTBEAT_OUTGOING_MS,
    });
    this.rxStomp = rxStomp;

    this.stateSubscription = rxStomp.connectionState$.subscribe(state => this.onStateChange(state));
    this.stompErrorSubscription = rxStomp.stompErrors$.subscribe(() => this.onRevoked());
    this.topicSubscription = rxStomp
      .watch(`/topic/whiteboard/${boardId}`)
      .subscribe(message => this.onIncoming(message.body));
    this.errorQueueSubscription = rxStomp
      .watch('/user/queue/errors')
      .subscribe(() => this.onRevoked());

    rxStomp.activate();
  }

  /**
   * Tears down the STOMP connection, browser listeners and pending timers. Resets the
   * per-user undo/redo stack (US08.3.3 contract: "Stack undo réinitialisée à la
   * déconnexion" — {@link UndoRedoService.reset}), since it has no cross-session meaning.
   */
  disconnect(): void {
    window.removeEventListener('online', this.onlineListener);
    window.removeEventListener('offline', this.offlineListener);
    this.clearReconnectedToastTimer();

    this.topicSubscription?.unsubscribe();
    this.errorQueueSubscription?.unsubscribe();
    this.stateSubscription?.unsubscribe();
    this.stompErrorSubscription?.unsubscribe();
    this.topicSubscription = null;
    this.errorQueueSubscription = null;
    this.stateSubscription = null;
    this.stompErrorSubscription = null;

    void this.rxStomp?.deactivate();
    this.rxStomp = null;
    this.boardId = null;

    this.undoRedo.reset();
  }

  /**
   * Restarts the connection after a {@link MAX_RECONNECT_ATTEMPTS} failure (AC10 "Réessayer
   * manuellement" button). No-op if no board was ever connected.
   */
  retryManual(): void {
    if (!this.boardId || !this.rxStomp) {
      return;
    }
    this.attempts = 0;
    this.everConnecting = false;
    this.status.set('connecting');
    this.rxStomp.activate();
  }

  /**
   * Publishes a local `DRAW` action to the board room (AC2). No-op when disconnected —
   * `@stomp/rx-stomp` would otherwise silently queue the message locally, which would
   * let a user "publish" while the canvas is visually read-only.
   *
   * @param subType the DRAW sub-type (`stroke`/`shape`/`erase`/`move`/`resize`/`text`)
   * @param payload the tool-specific, opaque payload (see `WhiteboardCanvasComponent`)
   */
  publishDraw(subType: DrawSubType, payload: unknown): void {
    this.publish('DRAW', { type: subType, payload });
  }

  /**
   * Generic publish entry point — kept deliberately untyped in `data` so that a future
   * US (US08.3.3, undo/redo) can relay an `UNDO { eventId }` message through this same
   * service without a refactor. Never includes `userId`/`tenantId`: those are resolved
   * server-side from the authenticated STOMP principal (CLAUDE.md security rule).
   *
   * @param type the top-level STOMP action type (`DRAW`, `UNDO`, …)
   * @param data the type-specific payload map
   */
  publish(type: string, data: Record<string, unknown>): void {
    if (!this.rxStomp || !this.boardId || this.status() !== 'open') {
      return;
    }
    this.rxStomp.publish({
      destination: `/app/whiteboard/${this.boardId}/action`,
      body: JSON.stringify({ type, data }),
    });
  }

  // ─── Internal handlers ─────────────────────────────────────────────────────

  private onStateChange(state: RxStompState): void {
    switch (state) {
      case RxStompState.CONNECTING:
        this.everConnecting = true;
        this.status.set(this.hasConnectedOnce ? 'lost' : 'connecting');
        break;
      case RxStompState.OPEN:
        this.attempts = 0;
        if (this.hasConnectedOnce) {
          this.triggerReconnectedToast();
        }
        this.hasConnectedOnce = true;
        this.status.set('open');
        break;
      case RxStompState.CLOSED:
        this.onClosed();
        break;
      case RxStompState.CLOSING:
        break;
    }
  }

  private onClosed(): void {
    if (!this.everConnecting) {
      // Initial BehaviorSubject replay (idle state before the first connect attempt) —
      // not a real failed connection.
      return;
    }
    this.attempts += 1;
    if (this.attempts >= MAX_RECONNECT_ATTEMPTS) {
      this.status.set('failed');
      void this.rxStomp?.deactivate();
    } else {
      this.status.set('lost');
    }
  }

  private triggerReconnectedToast(): void {
    this.clearReconnectedToastTimer();
    this.showReconnectedToast.set(true);
    this.reconnectedToastTimer = setTimeout(() => {
      this.showReconnectedToast.set(false);
      this.reconnectedToastTimer = null;
    }, RECONNECTED_TOAST_DURATION_MS);
  }

  private clearReconnectedToastTimer(): void {
    if (this.reconnectedToastTimer !== null) {
      clearTimeout(this.reconnectedToastTimer);
      this.reconnectedToastTimer = null;
    }
    this.showReconnectedToast.set(false);
  }

  /**
   * Handles a revoked-access signal. Two real signals are treated identically:
   * - A STOMP `ERROR` frame (`stompErrors$`) — the protocol-level mechanism the AC refers
   *   to ("STOMP ERROR 1008"); most brokers close the connection after sending one.
   * - A message on `/user/queue/errors` — the concrete channel the already-merged backend
   *   (`WhiteboardChannelInterceptor`) actually uses to signal a denied SUBSCRIBE/SEND
   *   without closing the session (see its Javadoc). Reacting to both keeps this client
   *   correct against the real, deployed backend behaviour rather than only the AC text.
   */
  private onRevoked(): void {
    this.toast.show(this.transloco.translate('whiteboard.ws.revoked'), 'error');
    this.disconnect();
    void this.router.navigateByUrl('/whiteboard');
  }

  /**
   * Parses and validates an incoming broadcast frame body (AC "messages entrants
   * validés"), then forwards accepted `DRAW` actions to {@link remoteActions$}.
   * Unknown types, mismatched `boardId`, or malformed JSON are silently ignored.
   *
   * @param rawBody the raw STOMP message body (JSON text)
   */
  private onIncoming(rawBody: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawBody);
    } catch {
      return;
    }
    if (!this.isBroadcastMessage(parsed)) {
      return;
    }
    if (parsed.boardId !== this.boardId) {
      return;
    }
    if (!KNOWN_ACTION_TYPES.has(parsed.type)) {
      return;
    }
    if (parsed.type !== 'DRAW') {
      // JOIN/LEAVE/CURSOR_MOVE/UNDO/PARTICIPANTS_UPDATE are out of scope for this service
      // (US08.3.2c presence, US08.3.3 undo) — validated and silently ignored, not applied.
      return;
    }
    const data = parsed.data;
    const subType = data?.['type'];
    if (typeof subType !== 'string' || !KNOWN_DRAW_SUBTYPES.has(subType)) {
      return;
    }
    this.remoteActions$.next({
      type: 'DRAW',
      subType: subType as DrawSubType,
      payload: data?.['payload'],
    });
  }

  private isBroadcastMessage(value: unknown): value is {
    type: string;
    boardId: string;
    userId: string;
    data: Record<string, unknown> | null;
  } {
    if (typeof value !== 'object' || value === null) {
      return false;
    }
    const candidate = value as Record<string, unknown>;
    return typeof candidate['type'] === 'string' && typeof candidate['boardId'] === 'string';
  }

  /**
   * Derives the WebSocket URL from `environment.apiUrl`. Handles both the absolute dev
   * URL (`http://localhost:8083/api/collaboratif`) and the relative production URL
   * (`/api/collaboratif`, proxied by nginx — see `environment.prod.ts`).
   */
  private buildWsUrl(): string {
    const apiUrl = environment.apiUrl;
    if (/^https?:\/\//.test(apiUrl)) {
      return `${apiUrl.replace(/^http/, 'ws')}/ws/whiteboard`;
    }
    const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws';
    return `${scheme}://${window.location.host}${apiUrl}/ws/whiteboard`;
  }
}
