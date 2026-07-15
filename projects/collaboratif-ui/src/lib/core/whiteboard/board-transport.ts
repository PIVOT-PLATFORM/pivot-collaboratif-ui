import { Injectable, inject } from '@angular/core';
import { RxStomp } from '@stomp/rx-stomp';
import { ReconnectionTimeMode } from '@stomp/stompjs';
import { Subscription } from 'rxjs';
import { COLLABORATIF_API_URL, COLLABORATIF_BEARER_TOKEN } from './config/tokens';

/**
 * Realtime transport seam for the structured whiteboard, mirroring the socket.io
 * `emit(event, payload)` / `on(event, handler)` semantics of the PouetPouet reference
 * over the collaboratif STOMP contract.
 *
 * The full PouetPouet event vocabulary (`card:*`, `connection:*`, `frame:*`, `vote:*`,
 * `timer:*`, `boardfield:*`, `cardfield:*`, `cards:*`) is forwarded as
 * `{ type, data }` envelopes on `/app/whiteboard/{boardId}/action`, and inbound
 * `{ type, data }` broadcasts on `/topic/whiteboard/{boardId}` are demultiplexed back
 * to per-type handlers.
 *
 * ⚠️ WIP: `pivot-collaboratif-core` currently only implements the Socle actions
 * (`JOIN`/`LEAVE`/`DRAW`/`CURSOR_MOVE`/`UNDO` + shape/text/image). The structured
 * events below have **no backend handler yet** — the front is wired end-to-end and
 * will light up once the backend grows the matching action types. See the port EPIC.
 */
export abstract class BoardTransport {
  /** Opens the realtime connection for a board and starts demultiplexing broadcasts. */
  abstract connect(boardId: string): void;
  /** Closes the connection and clears all handlers. */
  abstract disconnect(boardId: string): void;
  /** Sends a `{ type, data }` action envelope to the board's action destination. */
  abstract emit(type: string, data: unknown): void;
  /** Subscribes to inbound broadcasts of a given `type`; returns an unsubscribe fn. */
  abstract on<T = unknown>(type: string, handler: (data: T) => void): () => void;
  /** Registers a callback fired on every automatic reconnect (to re-join the room). */
  abstract onReconnect(handler: () => void): () => void;
  /**
   * This connection's own opaque correlation id — a client-generated value, stable for the
   * lifetime of this transport instance, **not** the server's STOMP session id (fix/EN08.4).
   * Used for `card:moved`/`card:resized` sender exclusion: this same value is attached to
   * every outgoing `card:move`/`card:resize` action (see {@link StompBoardTransport.emit}) and
   * echoed back verbatim by the backend as `senderSessionId` in the broadcast — the consumer
   * (`BoardStore`) compares the two to recognise and ignore its own echo.
   */
  abstract getSessionId(): string;
}

interface Envelope {
  type: string;
  data?: unknown;
}

/**
 * STOMP-backed {@link BoardTransport}. Reuses the same broker URL / bearer-token
 * conventions as {@link import('./whiteboard-sync.service').WhiteboardSyncService}.
 */
@Injectable()
export class StompBoardTransport extends BoardTransport {
  private readonly apiUrl = inject(COLLABORATIF_API_URL);
  private readonly bearerToken = inject(COLLABORATIF_BEARER_TOKEN);

  private rxStomp: RxStomp | null = null;
  private boardId: string | null = null;
  private topicSub: Subscription | null = null;
  private stateSub: Subscription | null = null;
  private wasConnected = false;

  private readonly handlers = new Map<string, Set<(data: unknown) => void>>();
  private readonly reconnectHandlers = new Set<() => void>();

  /**
   * This transport instance's own opaque correlation id (see {@link BoardTransport.getSessionId}
   * for the full rationale). Generated once per instance — `BoardStore` is provided per board
   * container, so a fresh id is minted on every board mount, which is all sender-exclusion
   * needs (uniqueness across the *current* set of connected sessions, not stability across
   * reconnects or page reloads).
   */
  private readonly connectionId = crypto.randomUUID();

  /** Outgoing action types that carry this transport's {@link connectionId} for sender exclusion
   *  (fix/EN08.4) — see {@link BoardTransport.getSessionId}. */
  private static readonly SENDER_TAGGED_TYPES = new Set(['card:move', 'card:resize']);

  connect(boardId: string): void {
    this.boardId = boardId;
    const rxStomp = new RxStomp();
    rxStomp.configure({
      brokerURL: this.buildWsUrl(),
      reconnectDelay: 1000,
      maxReconnectDelay: 30000,
      reconnectTimeMode: ReconnectionTimeMode.EXPONENTIAL,
      heartbeatIncoming: 30000,
      heartbeatOutgoing: 10000,
      beforeConnect: (client: RxStomp) =>
        client.configure({ connectHeaders: this.buildConnectHeaders() }),
    });
    this.rxStomp = rxStomp;

    this.stateSub = rxStomp.connected$.subscribe(() => {
      if (this.wasConnected) {
        this.reconnectHandlers.forEach((h) => h());
      }
      this.wasConnected = true;
    });

    this.topicSub = rxStomp
      .watch(`/topic/whiteboard/${boardId}`)
      .subscribe((message) => this.dispatch(message.body));

    rxStomp.activate();
  }

  disconnect(boardId: string): void {
    this.topicSub?.unsubscribe();
    this.stateSub?.unsubscribe();
    void this.rxStomp?.deactivate();
    this.rxStomp = null;
    this.handlers.clear();
    this.reconnectHandlers.clear();
    this.wasConnected = false;
    this.boardId = boardId === this.boardId ? null : this.boardId;
  }

  emit(type: string, data: unknown): void {
    if (!this.rxStomp || !this.boardId) {
      return;
    }
    const payload = this.withSenderSessionId(type, data);
    this.rxStomp.publish({
      destination: `/app/whiteboard/${this.boardId}/action`,
      body: JSON.stringify({ type, data: payload }),
    });
  }

  on<T = unknown>(type: string, handler: (data: T) => void): () => void {
    const set = this.handlers.get(type) ?? new Set<(data: unknown) => void>();
    set.add(handler as (data: unknown) => void);
    this.handlers.set(type, set);
    return () => set.delete(handler as (data: unknown) => void);
  }

  onReconnect(handler: () => void): () => void {
    this.reconnectHandlers.add(handler);
    return () => this.reconnectHandlers.delete(handler);
  }

  getSessionId(): string {
    return this.connectionId;
  }

  /**
   * Attaches `senderSessionId: this.connectionId` to `card:move`/`card:resize` payloads only —
   * every other action type passes through unchanged. Centralised here rather than at each
   * `BoardStore` call site (`moveCard`, `commitDragCard`, `resizeCard`, `resizeCardBox`,
   * `commitResizeCard`, `scaleSelection`, `commitResizeSelection`, `moveFrame`,
   * `commitDragFrame`, `setCardPositions`, …) — there are too many emit sites for `card:move`/
   * `card:resize` to tag individually without a high risk of missing one.
   *
   * @param type the outgoing action type
   * @param data the raw payload — only tagged if it is a plain object (defensive; every real
   *             `card:move`/`card:resize` call site already sends one)
   * @return the payload, tagged if applicable
   */
  private withSenderSessionId(type: string, data: unknown): unknown {
    if (!StompBoardTransport.SENDER_TAGGED_TYPES.has(type)) {
      return data;
    }
    if (typeof data !== 'object' || data === null || Array.isArray(data)) {
      return data;
    }
    return { ...(data as Record<string, unknown>), senderSessionId: this.connectionId };
  }

  private dispatch(body: string): void {
    let envelope: Envelope;
    try {
      envelope = JSON.parse(body) as Envelope;
    } catch {
      return;
    }
    if (!envelope || typeof envelope.type !== 'string') {
      return;
    }
    const set = this.handlers.get(envelope.type);
    if (!set) {
      return;
    }
    set.forEach((h) => h(envelope.data));
  }

  private buildWsUrl(): string {
    const apiUrl = this.apiUrl;
    if (/^https?:\/\//.test(apiUrl)) {
      return `${apiUrl.replace(/^http/, 'ws')}/ws/whiteboard`;
    }
    const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws';
    return `${scheme}://${window.location.host}${apiUrl}/ws/whiteboard`;
  }

  private buildConnectHeaders(): Record<string, string> {
    const token =
      (window as unknown as { __PIVOT_E2E_BEARER_TOKEN__?: string }).__PIVOT_E2E_BEARER_TOKEN__ ??
      this.bearerToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  }
}
