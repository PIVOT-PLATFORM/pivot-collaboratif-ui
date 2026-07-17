import { Injectable, computed, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { firstValueFrom, timeout } from 'rxjs';
import { COLLABORATIF_API_URL, COLLABORATIF_CURRENT_USER } from './config/tokens';
import { BoardTransport } from './board-transport';
import { ToastService } from '../toast/toast.service';
import { DEFAULT_CARD_COLOR } from '../../whiteboard/model/colors';
import { parseShape, serializeShape } from '../../whiteboard/model/shape';
import {
  parseLabelFmt,
  parseTextFmt,
  serializeLabelFmt,
  serializeTextFmt,
  type TextAlign,
} from '../../whiteboard/model/card-format';
import {
  HISTORY_LIMIT,
  CURSOR_THROTTLE_MS,
  DEFAULT_CARD_W,
  DEFAULT_CARD_H,
} from '../../whiteboard/model/board-constants';
import type {
  Card,
  Connection,
  ConnectionPatch,
  Frame,
  BoardField,
  BoardDetail,
  BoardMember,
  BoardRole,
  PresenceUser,
  FieldValue,
  VoteSession,
  ClipboardCard,
} from '../../whiteboard/model/board.types';

interface HistoryEntry {
  undo: () => void;
  redo: () => void;
}

interface CursorState {
  name: string;
  avatar: string | null;
  x: number;
  y: number;
  ts: number;
}

type CardBox = { posX: number; posY: number; width: number; height: number };

/**
 * Bound on `loadBoard()`'s access/detail GET — this call now doubles as the fail-closed
 * access check formerly performed by `boardAccessGuard` (see `loadBoard()`), so it must
 * resolve (success or failure) within a bounded time instead of potentially hanging up to
 * nginx's own `proxy_read_timeout` (60s).
 */
const LOAD_BOARD_TIMEOUT_MS = 8_000;

/**
 * Safety window (F1) for an optimistically-rendered card to receive its authoritative
 * `card:created` echo. If none arrives within this delay (dropped message, backend error),
 * the provisional card is reaped so a failed creation cannot linger as a ghost sticky. Kept
 * generous — reconciliation is the normal, near-instant path; this is only a last-resort net.
 */
const OPTIMISTIC_CARD_TIMEOUT_MS = 10_000;

/**
 * Grace window (BUG 4 / BUG J) during which a card just released from a local drag/resize keeps
 * its optimistic geometry authoritative: inbound `card:moved`/`card:resized` echoes and room-wide
 * `board:state` snapshots for that card are ignored until it elapses. Covers the "snaps back
 * after drop" symptom — a late, stale echo of an earlier throttled position (or a `board:state`
 * broadcast a joining participant triggers) arriving just after the pointer is released must not
 * overwrite the final position the user let go at.
 *
 * Sized to outlast a full rate-limit recovery cycle (BUG J): a fast drag that momentarily
 * exceeds the backend's 30 SEND/s cap can force-close the session (250 ms close grace), which the
 * client rejoins after a {@code reconnectDelay} of 1000 ms; the ensuing room-wide `board:state`
 * then carries the server's last *stored* (stale, throttled) position and would snap the card
 * back. 2000 ms comfortably covers 250 ms + 1000 ms + the rejoin/broadcast round trip so the
 * front position the user released at always wins. The {@link MOVE_EMIT_THROTTLE_MS} cap makes
 * that force-close unlikely in the first place; this window is the belt-and-suspenders guarantee.
 */
const LOCAL_CONTROL_GRACE_MS = 2000;

/**
 * Minimum interval between `card:move` broadcasts during a drag (BUG J). The optimistic position
 * is applied to the local `cards` signal on every pointer move (smooth for the dragger); only the
 * *network* emit is throttled. Previously a per-frame `requestAnimationFrame` flush emitted ~60
 * SEND/s — on its own above the backend's 30 SEND/s cap, so a sustained fast drag tripped the
 * three-consecutive-violation force-close. 50 ms caps it at ~20/s, under the limit. The final drop
 * position is never throttled — {@link BoardStore.commitDragCard} flushes it immediately.
 */
const MOVE_EMIT_THROTTLE_MS = 50;

/** localStorage key mirroring the in-memory clipboard so copy/paste survives a board switch/reload. */
const CLIPBOARD_STORAGE_KEY = 'pivot-wb-clipboard';

/** Canvas-units offset added per successive paste so cards cascade (don't stack exactly). */
const PASTE_OFFSET_STEP = 24;

/**
 * Structured whiteboard state machine — the Angular port of the PouetPouet `useBoard`
 * hook (`apps/web/src/hooks/useBoard.ts`). Owns all board domain state (cards,
 * connections, frames, fields, votes, timer, presence), a 30-deep undo/redo history,
 * and the realtime protocol over {@link BoardTransport}.
 *
 * Provided **per board container** (component-level provider), not root — each open
 * board gets its own isolated instance, matching the per-page lifetime of `useBoard`.
 *
 * ⚠️ WIP: the realtime event vocabulary targets the full PouetPouet protocol; the
 * collaboratif backend only implements the Socle subset today (see {@link BoardTransport}).
 * REST shapes are mapped defensively where the backend contract differs.
 */
@Injectable()
export class BoardStore {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = inject(COLLABORATIF_API_URL);
  private readonly transport = inject(BoardTransport);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  private readonly currentUser = inject(COLLABORATIF_CURRENT_USER);

  // ── State signals ──────────────────────────────────────────────────────────
  readonly board = signal<BoardDetail | null>(null);
  readonly cards = signal<Card[]>([]);
  readonly connections = signal<Connection[]>([]);
  readonly frames = signal<Frame[]>([]);
  readonly fields = signal<BoardField[]>([]);
  readonly selectedIds = signal<ReadonlySet<string>>(new Set());
  readonly importCount = signal(0);
  readonly isLoading = signal(true);
  readonly userRole = signal<BoardRole | null>(null);
  readonly accessDenied = signal(false);
  readonly presence = signal<PresenceUser[]>([]);
  readonly members = signal<BoardMember[]>([]);
  readonly cursors = signal<ReadonlyMap<string, CursorState>>(new Map());
  readonly remoteEditors = signal<ReadonlyMap<string, { userId: string; name: string }>>(new Map());
  readonly timerEndsAt = signal<number | null>(null);
  readonly activeVoteSession = signal<VoteSession | null>(null);
  readonly lastVoteSession = signal<VoteSession | null>(null);
  /**
   * US08.12.2 — the current user's own {@code public.users.id}, fetched from
   * {@code GET /whiteboard/me}. The realtime channel never carries a self identity, so the
   * dot-vote UI needs this to tell which votes in a session are the caller's own.
   */
  readonly selfUserId = signal<string | null>(null);

  readonly isReadonly = computed(() => this.userRole() === 'VIEWER');

  /**
   * US08.9.3 — current z-order extent across *every* orderable item on the board (cards and
   * frames share a single z-index space). There is no absolute "front"/"back" value: the
   * bring-to-front / send-to-back targets are derived relative to this extent. Falls back to
   * `{ min: 1, max: 1 }` on an empty board so the first ordered item still lands on a sane
   * positive layer.
   */
  private readonly layerExtent = computed<{ min: number; max: number }>(() => {
    const layers = [...this.cards().map((c) => c.layer), ...this.frames().map((f) => f.layer)];
    if (layers.length === 0) {
      return { min: 1, max: 1 };
    }
    return { min: Math.min(...layers), max: Math.max(...layers) };
  });

  /** US08.9.3 — target layer that lifts an item above all others (one past the current highest). */
  readonly frontLayer = computed(() => this.layerExtent().max + 1);
  /** US08.9.3 — target layer that drops an item beneath all others (one below the current lowest). */
  readonly backLayer = computed(() => this.layerExtent().min - 1);

  /** US08.12.2 — total dot-votes cast per card in the active session (all users). */
  readonly voteTallyByCard = computed<ReadonlyMap<string, number>>(() => {
    const session = this.activeVoteSession();
    const tally = new Map<string, number>();
    if (!session) {
      return tally;
    }
    for (const vote of session.votes) {
      tally.set(vote.cardId, (tally.get(vote.cardId) ?? 0) + 1);
    }
    return tally;
  });

  /** US08.12.2 — dot-votes the current user has cast per card in the active session. */
  readonly myVoteTallyByCard = computed<ReadonlyMap<string, number>>(() => {
    const session = this.activeVoteSession();
    const me = this.selfUserId();
    const tally = new Map<string, number>();
    if (!session || me === null) {
      return tally;
    }
    for (const vote of session.votes) {
      if (String(vote.userId) === me) {
        tally.set(vote.cardId, (tally.get(vote.cardId) ?? 0) + 1);
      }
    }
    return tally;
  });

  /** US08.12.2 — total votes the current user has spent in the active session. */
  readonly myVotesUsed = computed<number>(() => {
    let used = 0;
    for (const count of this.myVoteTallyByCard().values()) {
      used += count;
    }
    return used;
  });

  /** US08.12.2 — the current user's remaining vote budget, or `null` when no vote is active. */
  readonly voteBudgetRemaining = computed<number | null>(() => {
    const session = this.activeVoteSession();
    if (!session) {
      return null;
    }
    return Math.max(0, session.votesPerPerson - this.myVotesUsed());
  });

  /** Cards copied via {@link copySelected}, portable across boards (also mirrored to localStorage). */
  readonly clipboard = signal<ClipboardCard[]>([]);
  /** True when the clipboard holds at least one card — gates the paste affordance. */
  readonly canPaste = computed(() => this.clipboard().length > 0);
  /** Incremental offset so repeated pastes of the same clipboard cascade instead of stacking. */
  private pasteOffset = 0;

  private readonly historyVersion = signal(0);
  readonly canUndo = computed(() => (this.historyVersion(), this.undoStack.length > 0));
  readonly canRedo = computed(() => (this.historyVersion(), this.redoStack.length > 0));

  // ── History ─────────────────────────────────────────────────────────────────
  private undoStack: HistoryEntry[] = [];
  private redoStack: HistoryEntry[] = [];

  // ── Transient interaction state (was React refs) ─────────────────────────────
  private boardId = '';
  private readonly unsubscribers: Array<() => void> = [];
  private readonly pendingLocalTags = new Set<string>();
  /** Per-clientTag reaper timers for optimistically-rendered cards awaiting their echo (F1). */
  private readonly optimisticCardTimers = new Map<string, ReturnType<typeof setTimeout>>();
  /** Id of a freshly self-created card that should open in edit mode (one-shot). */
  readonly autoEditCardId = signal<string | null>(null);
  private readonly pendingCardHistory: Array<(card: Card) => void> = [];
  private readonly pendingConnHistory: Array<(conn: Connection) => void> = [];
  private readonly pendingFrameHistory: Array<(frame: Frame) => void> = [];
  private readonly pendingGroupHistory: Array<(groupId: string) => void> = [];

  private cardDragStart: Map<string, { posX: number; posY: number }> | null = null;
  private readonly moveEmit = { timer: null as ReturnType<typeof setTimeout> | null, lastTs: 0, pending: new Map<string, { posX: number; posY: number }>() };
  /**
   * Coalesces the resize and frame-drag emit paths the way {@link moveEmit} already coalesces
   * card drags: keeps only the latest payload per `(channel, id)` and flushes them all on a
   * {@link MOVE_EMIT_THROTTLE_MS} timer — one WS frame per entity per channel per tick instead of
   * one per `pointermove` (a frame drag over N cards previously emitted `1 + N` frames per move).
   * Local signal updates stay immediate (visual smoothness); only the network emits are throttled.
   * The matching `commit*` handlers flush this buffer before their authoritative final emit, so no
   * stale intermediate can be broadcast after the commit.
   */
  private readonly emitCoalescer = {
    timer: null as ReturnType<typeof setTimeout> | null,
    lastTs: 0,
    pending: new Map<string, { channel: 'card:move' | 'card:resize' | 'frame:move' | 'frame:resize'; payload: Record<string, unknown> }>(),
  };
  private cardResizeStart: { id: string; posX: number; posY: number; width: number; height: number } | null = null;
  private selectionResizeStart: Map<string, CardBox> | null = null;
  private selResizeEmitTs = 0;
  private frameDragStart: {
    frameId: string;
    framePos: { posX: number; posY: number };
    cardPositions: Map<string, { posX: number; posY: number }>;
  } | null = null;
  private frameResizeStart: { id: string; posX: number; posY: number; width: number; height: number } | null = null;
  private cursorThrottleTs = 0;
  /** Card ids under active local drag/resize — their optimistic geometry is authoritative, so
   *  inbound geometry echoes and `board:state` snapshots for them are ignored (BUG 4). */
  private readonly activeLocalCards = new Set<string>();
  /** Post-release grace timers per card id (see {@link LOCAL_CONTROL_GRACE_MS}). */
  private readonly localControlGraceTimers = new Map<string, ReturnType<typeof setTimeout>>();

  // ── Lifecycle ─────────────────────────────────────────────────────────────────
  /** Loads the board over REST and opens the realtime room. Call once from the container. */
  init(boardId: string): void {
    this.boardId = boardId;
    void this.loadBoard();
    void this.loadMembers();
    void this.loadVote('current', this.activeVoteSession);
    void this.loadVote('last', this.lastVoteSession);
    this.transport.connect(boardId);
    // F3 — announce our presence identity on join so other participants see our real name/avatar
    // (the backend defaults an empty `displayName` to "Anonymous"). Re-sent verbatim on every
    // reconnect. The board is scoped by the destination URL, so it is not part of this payload.
    this.transport.emit('board:join', this.buildJoinPayload());
    this.unsubscribers.push(
      this.transport.onReconnect(() => this.transport.emit('board:join', this.buildJoinPayload())),
    );
    this.registerHandlers();
  }

  /**
   * Builds the `board:join` presence payload from {@link COLLABORATIF_CURRENT_USER} (F3). A field
   * is included only when known: an unknown `displayName`/`avatarUrl` is omitted entirely so the
   * backend applies its own fallback rather than persisting a `null`.
   */
  private buildJoinPayload(): { displayName?: string; avatarUrl?: string } {
    const user = this.currentUser();
    const payload: { displayName?: string; avatarUrl?: string } = {};
    if (user.displayName != null && user.displayName !== '') {
      payload.displayName = user.displayName;
    }
    if (user.avatarUrl != null && user.avatarUrl !== '') {
      payload.avatarUrl = user.avatarUrl;
    }
    return payload;
  }

  /** Leaves the room and tears down subscriptions. Call from the container's ngOnDestroy. */
  destroy(): void {
    if (this.moveEmit.timer != null) {
      clearTimeout(this.moveEmit.timer);
      this.moveEmit.timer = null;
    }
    if (this.emitCoalescer.timer != null) {
      clearTimeout(this.emitCoalescer.timer);
      this.emitCoalescer.timer = null;
    }
    this.emitCoalescer.pending.clear();
    this.optimisticCardTimers.forEach((t) => clearTimeout(t));
    this.optimisticCardTimers.clear();
    this.localControlGraceTimers.forEach((t) => clearTimeout(t));
    this.localControlGraceTimers.clear();
    this.activeLocalCards.clear();
    this.transport.emit('board:leave', this.boardId);
    this.unsubscribers.forEach((u) => u());
    this.unsubscribers.length = 0;
    this.transport.disconnect(this.boardId);
  }

  private async loadBoard(): Promise<void> {
    try {
      // GET /whiteboard/boards/{id} returns the backend's BoardResponse shape (`title`, not
      // `name`; no `cards` — those arrive separately over the WS `board:state` reply) — mapped
      // here into this store's BoardDetail shape rather than typed/read as one directly.
      const data = await firstValueFrom(
        this.http
          .get<{
            id: string;
            title: string;
            role?: BoardRole;
            description: string | null;
            coverImage: string | null;
            maxParticipants: number | null;
            enabledActivities: string[];
          }>(`${this.apiUrl}/whiteboard/boards/${this.boardId}`)
          .pipe(timeout(LOAD_BOARD_TIMEOUT_MS)),
      );
      this.board.set({
        id: data.id,
        name: data.title,
        description: data.description,
        coverImage: data.coverImage,
        maxParticipants: data.maxParticipants,
        enabledActivities: data.enabledActivities,
        templateDraftOf: null,
        cards: this.cards(),
      });
      if (data.role) {
        this.userRole.set(data.role);
      }
      this.isLoading.set(false);
      this.accessDenied.set(false);
    } catch {
      // Fail-closed on ANY failure (403/404 denial, network error, ...) — replicates the
      // `boardAccessGuard` contract this replaces (US08.3.2b AC5): the canvas shell now
      // mounts immediately instead of waiting on this check behind a route guard, so the
      // same toast + redirect happens here, reactively, once the check actually resolves.
      this.accessDenied.set(true);
      this.isLoading.set(false);
      this.toast.show('whiteboard.guard.accessDenied', 'error');
      void this.router.navigateByUrl('/whiteboard');
    }
  }

  private async loadMembers(): Promise<void> {
    try {
      const members = await firstValueFrom(
        this.http.get<BoardMember[]>(`${this.apiUrl}/whiteboard/boards/${this.boardId}/members`),
      );
      this.members.set(members);
    } catch {
      /* non-fatal */
    }
  }

  private async loadVote(which: 'current' | 'last', target: typeof this.activeVoteSession): Promise<void> {
    try {
      const session = await firstValueFrom(
        this.http.get<VoteSession | null>(`${this.apiUrl}/whiteboard/boards/${this.boardId}/vote/${which}`),
      );
      if (session) {
        target.set(session);
        if (which === 'current') {
          // Rejoining an already-active vote — resolve our own id so the UI can attribute votes.
          void this.ensureSelfUserId();
        }
      }
    } catch {
      /* no session yet (404) — nothing to restore */
    }
  }

  /**
   * Lazily fetches the current user's own id the first time a dot-vote makes it relevant
   * (US08.12.2) — never on plain board open, so read-only viewers never trigger it. Fetched at
   * most once per store; non-fatal on failure (the UI falls back to read-only tallies with no
   * own-dot highlighting or un-casting).
   */
  private async ensureSelfUserId(): Promise<void> {
    if (this.selfUserId() !== null) {
      return;
    }
    try {
      const me = await firstValueFrom(
        this.http.get<{ userId: string }>(`${this.apiUrl}/whiteboard/me`),
      );
      this.selfUserId.set(me.userId);
    } catch {
      /* self id unavailable — dot-vote degrades to read-only tallies */
    }
  }

  // ── Realtime handlers ───────────────────────────────────────────────────────
  private on<T>(type: string, handler: (data: T) => void): void {
    this.unsubscribers.push(this.transport.on<T>(type, handler));
  }

  private registerHandlers(): void {
    this.on<{ cards: Card[]; connections: Connection[]; frames: Frame[]; fields: BoardField[]; role?: BoardRole }>(
      'board:state',
      ({ cards, connections, frames, fields, role }) => {
        this.cards.set(this.mergeBoardStateCards(cards));
        this.connections.set(connections);
        this.frames.set(frames);
        this.fields.set(fields);
        if (role) {
          this.userRole.set(role);
        }
      },
    );

    this.on<{ cards: Card[]; connections: Connection[]; frames?: Frame[]; fields?: BoardField[] }>(
      'board:imported',
      ({ cards, connections, frames, fields }) => {
        this.cards.update((prev) => [...prev, ...cards.map((c) => ({ ...c, fieldValues: c.fieldValues ?? [] }))]);
        this.connections.update((prev) => [...prev, ...connections]);
        if (frames?.length) {
          this.frames.update((prev) => [...prev, ...frames]);
        }
        if (fields?.length) {
          this.fields.update((prev) => [...prev, ...fields.filter((f) => !prev.some((p) => p.id === f.id))]);
        }
        this.importCount.update((n) => n + 1);
      },
    );

    this.on<{ cardIds: string[]; connectionIds: string[]; frameIds: string[] }>(
      'board:import-undone',
      ({ cardIds, connectionIds, frameIds }) => {
        const cardSet = new Set(cardIds);
        const connSet = new Set(connectionIds);
        const frameSet = new Set(frameIds);
        this.cards.update((prev) => prev.filter((c) => !cardSet.has(c.id)));
        this.connections.update((prev) =>
          prev.filter((c) => !connSet.has(c.id) && !cardSet.has(c.fromId) && !cardSet.has(c.toId)),
        );
        this.frames.update((prev) => prev.filter((f) => !frameSet.has(f.id)));
      },
    );

    this.on<string>('board:error', (msg) => {
      if (msg === 'Accès refusé') {
        this.accessDenied.set(true);
      }
    });

    this.on<void>('board:resetted', () => {
      this.cards.set([]);
      this.connections.set([]);
      this.frames.set([]);
      this.selectedIds.set(new Set());
    });

    this.on<{ cardId: string; userId: string; name?: string; editing: boolean }>('card:editing', (data) => {
      this.remoteEditors.update((prev) => {
        const next = new Map(prev);
        if (data.editing && data.name) {
          next.set(data.cardId, { userId: data.userId, name: data.name });
        } else {
          next.delete(data.cardId);
        }
        return next;
      });
    });

    this.on<PresenceUser[]>('board:presence', (users) => {
      this.presence.set(users);
      const known = new Set(this.members().map((m) => m.id));
      if (users.some((u) => !known.has(u.id))) {
        void this.loadMembers();
      }
      const activeIds = new Set(users.map((u) => u.id));
      this.cursors.update((prev) => {
        const next = new Map(prev);
        for (const uid of next.keys()) {
          if (!activeIds.has(uid)) {
            next.delete(uid);
          }
        }
        return next;
      });
    });

    this.on<{ userId: string; name: string; avatar: string | null; x: number; y: number }[]>(
      'board:cursors',
      (batch) => {
        const now = Date.now();
        this.cursors.update((prev) => {
          const next = new Map(prev);
          for (const c of batch) {
            next.set(c.userId, { name: c.name, avatar: c.avatar, x: c.x, y: c.y, ts: now });
          }
          return next;
        });
      },
    );

    this.on<{ endsAt: number; serverNow?: number }>('timer:started', ({ endsAt, serverNow }) =>
      this.timerEndsAt.set(typeof serverNow === 'number' ? Date.now() + (endsAt - serverNow) : endsAt),
    );
    this.on<void>('timer:stopped', () => this.timerEndsAt.set(null));

    this.on<VoteSession>('vote:session:started', (s) => {
      this.activeVoteSession.set(s);
      // A vote just started room-wide — resolve our own id so we can cast/track our dots.
      void this.ensureSelfUserId();
    });
    this.on<VoteSession>('vote:updated', (s) => this.activeVoteSession.set(s));
    this.on<VoteSession>('vote:session:closed', (s) => {
      this.activeVoteSession.set(null);
      this.lastVoteSession.set(s);
    });

    this.on<{ ids: string[]; locked: boolean }>('cards:locked', ({ ids, locked }) =>
      this.cards.update((prev) => prev.map((c) => (ids.includes(c.id) ? { ...c, locked } : c))),
    );
    this.on<{ id: string; layer: number }>('card:layered', ({ id, layer }) =>
      this.cards.update((prev) => prev.map((c) => (c.id === id ? { ...c, layer } : c))),
    );
    this.on<{ id: string; layer: number }>('frame:layered', ({ id, layer }) =>
      this.frames.update((prev) => prev.map((f) => (f.id === id ? { ...f, layer } : f))),
    );

    this.on<Card & { clientTag?: string }>('card:created', (payload) => {
      const { clientTag, ...rest } = payload;
      const card: Card = { ...(rest as Card), fieldValues: (rest as Card).fieldValues ?? [] };
      // A tag we're still waiting on ⇒ this is the authoritative echo of a card WE created
      // optimistically (F1). Reconcile the provisional entry (keyed by clientTag) in place
      // rather than appending a duplicate, and carry the auto-edit flag from the temporary id
      // over to the real one so the sticky stays in edit mode across the swap.
      const isOwnOptimistic = !!clientTag && this.pendingLocalTags.delete(clientTag);
      if (isOwnOptimistic && clientTag) {
        this.clearOptimisticTimer(clientTag);
        if (this.autoEditCardId() === clientTag) {
          this.autoEditCardId.set(card.id);
        }
      }
      this.pendingCardHistory.shift()?.(card);
      this.cards.update((prev) => {
        if (isOwnOptimistic && clientTag) {
          const idx = prev.findIndex((c) => c.id === clientTag);
          if (idx !== -1) {
            const next = [...prev];
            // BUG A — carry the provisional card's stable `key` (the clientTag) onto the server
            // card, whose payload has none, so the canvas trackBy sees no identity change and the
            // board-card is reconciled in place rather than re-mounted (preserves a live edit).
            next[idx] = { ...card, key: prev[idx].key ?? clientTag };
            return next;
          }
        }
        // Another participant's card, or an already-reaped optimistic one: append (deduped).
        return prev.some((c) => c.id === card.id) ? prev : [...prev, card];
      });
    });
    // Sender exclusion (fix/EN08.4): senderSessionId is this transport's own opaque connection
    // id, echoed back verbatim by the backend (never persisted server-side, see
    // CanvasActionService#handleCardMove's Javadoc). When it matches our own id, this broadcast
    // is the echo of a move/resize *we* just sent — already applied optimistically by
    // moveCard/resizeCard/etc — so re-applying it here would only reintroduce visual jitter on
    // a slower-arriving, possibly stale network round trip. Every other session's card:moved/
    // card:resized (no senderSessionId, or a different one) is applied normally.
    this.on<Card & { senderSessionId?: string }>('card:moved', (payload) => {
      const { senderSessionId, ...card } = payload;
      if (senderSessionId && senderSessionId === this.transport.getSessionId()) {
        return;
      }
      // A card the local user is dragging (or just released, within its grace window) keeps its
      // authoritative optimistic position — a stale echo must never snap it back (BUG 4c).
      if (this.isLocallyControlled(card.id)) {
        return;
      }
      this.cards.update((prev) => prev.map((c) => (c.id === card.id ? { ...c, ...card } : c)));
    });
    this.on<Card & { senderSessionId?: string }>('card:resized', (payload) => {
      const { senderSessionId, ...card } = payload;
      if (senderSessionId && senderSessionId === this.transport.getSessionId()) {
        return;
      }
      if (this.isLocallyControlled(card.id)) {
        return;
      }
      this.cards.update((prev) => prev.map((c) => (c.id === card.id ? { ...c, ...card } : c)));
    });
    // card:update only ever changes content — never apply the echo's geometry (would clobber
    // a freshly grown height with a stale racing value).
    this.on<Card>('card:updated', (card) =>
      this.cards.update((prev) =>
        prev.map((c) => {
          if (c.id !== card.id) {
            return c;
          }
          const { posX, posY, width, height, ...rest } = card;
          void posX;
          void posY;
          void width;
          void height;
          return { ...c, ...rest };
        }),
      ),
    );
    this.on<string>('card:deleted', (id) => {
      this.cards.update((prev) => prev.filter((c) => c.id !== id));
      this.connections.update((prev) => prev.filter((c) => c.fromId !== id && c.toId !== id));
      this.selectedIds.update((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    });
    this.on<Card>('card:recolored', (card) =>
      this.cards.update((prev) => prev.map((c) => (c.id === card.id ? { ...c, ...card } : c))),
    );
    this.on<{ id: string; meta: Card['meta'] }>('card:meta_updated', ({ id, meta }) =>
      this.cards.update((prev) => prev.map((c) => (c.id === id ? { ...c, meta } : c))),
    );

    this.on<{ cardIds: string[]; groupId: string }>('cards:grouped', ({ cardIds, groupId }) => {
      this.pendingGroupHistory.shift()?.(groupId);
      this.cards.update((prev) => prev.map((c) => (cardIds.includes(c.id) ? { ...c, groupId } : c)));
    });
    this.on<string>('cards:ungrouped', (groupId) =>
      this.cards.update((prev) => prev.map((c) => (c.groupId === groupId ? { ...c, groupId: null } : c))),
    );
    this.on<{ groupId: string; color: string }>('cards:group-colored', ({ groupId, color }) =>
      this.cards.update((prev) => prev.map((c) => (c.groupId === groupId ? { ...c, groupColor: color } : c))),
    );

    this.on<Connection>('connection:created', (conn) => {
      this.pendingConnHistory.shift()?.(conn);
      this.connections.update((prev) => (prev.some((c) => c.id === conn.id) ? prev : [...prev, conn]));
    });
    this.on<string>('connection:deleted', (id) =>
      this.connections.update((prev) => prev.filter((c) => c.id !== id)),
    );
    // Unlike card:updated (content-only patch), connection:updated broadcasts the connector's
    // full, authoritative state (US08.7.2 AC4) — the in-memory entry is replaced outright
    // rather than merged, so a field a concurrent update cleared server-side (e.g. label back
    // to null) can never linger locally from a stale spread.
    this.on<Connection>('connection:updated', (conn) =>
      this.connections.update((prev) => prev.map((c) => (c.id === conn.id ? conn : c))),
    );

    this.on<Frame>('frame:created', (frame) => {
      this.pendingFrameHistory.shift()?.(frame);
      // Idempotent append: the `frame:created` broadcast is emitter-included, so the creator also
      // receives its own echo — and a reconnect can replay it after `board:state` already carried
      // the frame. Dedup by id (same convention as `connection:created`/`boardfield:created`) so a
      // frame is never rendered twice; a blind append duplicated it on the creating client
      // (US08.8.1).
      this.frames.update((prev) => (prev.some((f) => f.id === frame.id) ? prev : [...prev, frame]));
    });
    this.on<Frame>('frame:moved', (frame) =>
      this.frames.update((prev) => prev.map((f) => (f.id === frame.id ? { ...f, ...frame } : f))),
    );
    this.on<Frame>('frame:resized', (frame) =>
      this.frames.update((prev) => prev.map((f) => (f.id === frame.id ? { ...f, ...frame } : f))),
    );
    this.on<Frame>('frame:updated', (frame) =>
      this.frames.update((prev) => prev.map((f) => (f.id === frame.id ? { ...f, ...frame } : f))),
    );
    this.on<string>('frame:deleted', (id) => this.frames.update((prev) => prev.filter((f) => f.id !== id)));

    // Idempotent append: the `boardfield:created` broadcast is emitter-included, so the creator
    // also receives its own echo — and a reconnect can replay it after `board:state` already
    // carried the field. Dedup by id (same convention as the `board:imported` merge) so a field
    // is never rendered twice; a blind append duplicated it on the creating client (US08.10.1).
    this.on<BoardField>('boardfield:created', (field) =>
      this.fields.update((prev) => (prev.some((f) => f.id === field.id) ? prev : [...prev, field])),
    );
    this.on<BoardField>('boardfield:updated', (field) =>
      this.fields.update((prev) => prev.map((f) => (f.id === field.id ? { ...f, ...field } : f))),
    );
    this.on<string>('boardfield:deleted', (id) => this.fields.update((prev) => prev.filter((f) => f.id !== id)));

    this.on<FieldValue>('cardfield:updated', (fv) => {
      this.cards.update((prev) =>
        prev.map((c) => {
          if (c.id !== fv.cardId) {
            return c;
          }
          const exists = c.fieldValues.find((v) => v.fieldId === fv.fieldId);
          return {
            ...c,
            fieldValues: exists
              ? c.fieldValues.map((v) => (v.fieldId === fv.fieldId ? fv : v))
              : [...c.fieldValues, fv],
          };
        }),
      );
    });
    this.on<{ cardId: string; fieldId: string }>('cardfield:cleared', ({ cardId, fieldId }) =>
      this.cards.update((prev) =>
        prev.map((c) => (c.id !== cardId ? c : { ...c, fieldValues: c.fieldValues.filter((v) => v.fieldId !== fieldId) })),
      ),
    );
  }

  // ── History ─────────────────────────────────────────────────────────────────
  private bumpHistory(): void {
    this.historyVersion.update((v) => v + 1);
  }
  private pushHistory(entry: HistoryEntry): void {
    this.undoStack = [...this.undoStack.slice(-(HISTORY_LIMIT - 1)), entry];
    this.redoStack = [];
    this.bumpHistory();
  }
  undo(): void {
    const entry = this.undoStack.pop();
    if (!entry) {
      return;
    }
    this.redoStack.push(entry);
    entry.undo();
    this.bumpHistory();
  }
  redo(): void {
    const entry = this.redoStack.pop();
    if (!entry) {
      return;
    }
    this.undoStack.push(entry);
    entry.redo();
    this.bumpHistory();
  }

  // ── Selection ─────────────────────────────────────────────────────────────────
  selectCards(ids: ReadonlySet<string>): void {
    this.selectedIds.set(ids);
  }
  consumeAutoEdit(cardId: string): boolean {
    if (this.autoEditCardId() === cardId) {
      this.autoEditCardId.set(null);
      return true;
    }
    return false;
  }
  /**
   * Requests inline edit mode for an existing card by id. Reuses the auto-edit flag the card's
   * effect reacts to (→ `startEdit`); the flag is reset to null by `consumeAutoEdit` as soon as
   * editing begins, so it re-arms for a subsequent double-click. This is the double-click path
   * when the DOM `dblclick` never reaches the card because the surface captured the pointer
   * (see `StructuredCanvasComponent.onDoubleClick`).
   */
  requestEdit(cardId: string): void {
    this.autoEditCardId.set(cardId);
  }
  notifyEditing(cardId: string, editing: boolean): void {
    this.transport.emit('card:editing', { boardId: this.boardId, cardId, editing });
  }

  private unlockedSelectedIds(): string[] {
    const cards = this.cards();
    return Array.from(this.selectedIds()).filter((id) => !cards.find((c) => c.id === id)?.locked);
  }

  // ── Cards ─────────────────────────────────────────────────────────────────────
  addCard(posX: number, posY: number, type?: string, content?: string, color?: string, width?: number, height?: number): void {
    const cardColor = color ?? DEFAULT_CARD_COLOR;
    const extra: Record<string, number> = {};
    if (width !== undefined) {
      extra['width'] = width;
    }
    if (height !== undefined) {
      extra['height'] = height;
    }
    const emitParams = { boardId: this.boardId, content: content ?? '', posX, posY, color: cardColor, type: type ?? 'TEXT', ...extra };

    this.pendingCardHistory.push((card: Card) => {
      let trackedId = card.id;
      this.pushHistory({
        undo: () => this.transport.emit('card:delete', { id: trackedId, boardId: this.boardId }),
        redo: () => {
          this.transport.emit('card:create', emitParams);
          this.pendingCardHistory.push((newCard: Card) => (trackedId = newCard.id));
        },
      });
    });

    const clientTag = crypto.randomUUID();
    this.pendingLocalTags.add(clientTag);

    // F1 — optimistic render: insert a provisional card immediately (keyed by clientTag as its
    // temporary id) so the sticky appears without waiting for the server round trip, mirroring
    // the fluidity of the already-optimistic move/resize paths. The matching `card:created`
    // echo replaces this entry in place (see registerHandlers); a failed/dropped create is
    // reaped by the safety timeout below so no ghost card lingers.
    const provisional: Card = {
      id: clientTag,
      // BUG A — stable identity for the canvas `@for` trackBy. Preserved verbatim when the
      // authoritative `card:created` echo swaps `id` from this clientTag to the server uuid, so
      // the board-card is never destroyed and re-mounted mid-edit (which would drop the in-flight
      // textarea content and re-trigger auto-edit).
      key: clientTag,
      boardId: this.boardId,
      type: emitParams.type,
      content: emitParams.content,
      meta: null,
      posX,
      posY,
      width: width ?? DEFAULT_CARD_W,
      height: height ?? DEFAULT_CARD_H,
      color: cardColor,
      groupId: null,
      groupColor: null,
      locked: false,
      layer: 1,
      fieldValues: [],
    };
    this.cards.update((prev) => [...prev, provisional]);
    // Open the freshly created sticky in edit mode right away; reconciliation carries this flag
    // over to the real server id (see the `card:created` handler).
    this.autoEditCardId.set(clientTag);
    this.optimisticCardTimers.set(
      clientTag,
      setTimeout(() => this.reapOptimisticCard(clientTag), OPTIMISTIC_CARD_TIMEOUT_MS),
    );

    this.transport.emit('card:create', { ...emitParams, clientTag });
  }

  /** Clears (and forgets) the optimistic reaper timer for a clientTag, if any (F1). */
  private clearOptimisticTimer(clientTag: string): void {
    const timer = this.optimisticCardTimers.get(clientTag);
    if (timer !== undefined) {
      clearTimeout(timer);
      this.optimisticCardTimers.delete(clientTag);
    }
  }

  /**
   * Safety net (F1): drops a provisional card whose authoritative `card:created` echo never
   * arrived within {@link OPTIMISTIC_CARD_TIMEOUT_MS}. No-op if the tag was already reconciled.
   */
  private reapOptimisticCard(clientTag: string): void {
    this.optimisticCardTimers.delete(clientTag);
    if (!this.pendingLocalTags.delete(clientTag)) {
      return;
    }
    this.cards.update((prev) => prev.filter((c) => c.id !== clientTag));
    if (this.autoEditCardId() === clientTag) {
      this.autoEditCardId.set(null);
    }
  }

  // ── Local interaction authority (BUG 4: no snap-back / no disappear) ─────────
  /** True while `id` is under active local drag/resize or within its post-release grace. */
  private isLocallyControlled(id: string): boolean {
    return this.activeLocalCards.has(id) || this.localControlGraceTimers.has(id);
  }

  /** Marks card ids as locally controlled (drag/resize start), cancelling any pending grace. */
  private markLocalControl(ids: Iterable<string>): void {
    for (const id of ids) {
      this.activeLocalCards.add(id);
      const grace = this.localControlGraceTimers.get(id);
      if (grace !== undefined) {
        clearTimeout(grace);
        this.localControlGraceTimers.delete(id);
      }
    }
  }

  /** Releases active control (drag/resize commit) into a short grace window (see
   *  {@link LOCAL_CONTROL_GRACE_MS}) so a late, stale echo cannot revert the released card. */
  private releaseLocalControl(ids: Iterable<string>): void {
    for (const id of ids) {
      if (!this.activeLocalCards.delete(id)) {
        continue;
      }
      const existing = this.localControlGraceTimers.get(id);
      if (existing !== undefined) {
        clearTimeout(existing);
      }
      this.localControlGraceTimers.set(
        id,
        setTimeout(() => this.localControlGraceTimers.delete(id), LOCAL_CONTROL_GRACE_MS),
      );
    }
  }

  /**
   * Reconciles a room-wide `board:state` snapshot against local state (BUG 4). The backend
   * re-broadcasts `board:state` to the whole room on every participant JOIN (not just to the
   * joiner), so a blind `cards.set(snapshot)` would (a) drop a card we created optimistically
   * that the snapshot predates — "cards disappear randomly" — and (b) yank a card we are
   * actively dragging back to its server position. This merge keeps our optimistic geometry for
   * locally-controlled cards and re-appends still-pending provisional cards the snapshot lacks.
   */
  private mergeBoardStateCards(serverCards: Card[]): Card[] {
    const currentById = new Map(this.cards().map((c) => [c.id, c]));
    const merged = serverCards.map((sc) => {
      const local = currentById.get(sc.id);
      return local && this.isLocallyControlled(sc.id)
        ? { ...sc, posX: local.posX, posY: local.posY, width: local.width, height: local.height }
        : sc;
    });
    const serverIds = new Set(serverCards.map((c) => c.id));
    for (const c of this.cards()) {
      if (this.pendingLocalTags.has(c.id) && !serverIds.has(c.id)) {
        merged.push(c);
      }
    }
    return merged;
  }

  private flushMoveEmits(): void {
    this.moveEmit.timer = null;
    this.moveEmit.lastTs = Date.now();
    const pending = this.moveEmit.pending;
    if (pending.size === 0) {
      return;
    }
    pending.forEach((p, cid) => this.transport.emit('card:move', { id: cid, boardId: this.boardId, posX: p.posX, posY: p.posY }));
    pending.clear();
  }
  private scheduleMoveFlush(): void {
    if (this.moveEmit.timer != null) {
      return;
    }
    const delay = Math.max(0, MOVE_EMIT_THROTTLE_MS - (Date.now() - this.moveEmit.lastTs));
    this.moveEmit.timer = setTimeout(() => this.flushMoveEmits(), delay);
  }

  /** Buffers the latest emit for a `(channel, id)` and schedules a throttled flush (see {@link emitCoalescer}). */
  private queueEmit(
    channel: 'card:move' | 'card:resize' | 'frame:move' | 'frame:resize',
    id: string,
    payload: Record<string, number>,
  ): void {
    this.emitCoalescer.pending.set(`${channel}|${id}`, { channel, payload: { id, boardId: this.boardId, ...payload } });
    if (this.emitCoalescer.timer != null) {
      return;
    }
    const delay = Math.max(0, MOVE_EMIT_THROTTLE_MS - (Date.now() - this.emitCoalescer.lastTs));
    this.emitCoalescer.timer = setTimeout(() => this.flushCoalescedEmits(false), delay);
  }

  /**
   * Flushes the coalesced emits. Intermediate throttled flushes ({@code guaranteed=false}) are
   * droppable — and when disconnected they emit nothing AND keep the pending values, so the latest
   * geometry survives for the guaranteed commit flush (or the next reconnect) rather than being lost
   * behind the transport's disconnect drop guard. The commit flush ({@code guaranteed=true}) always
   * emits, with guaranteed delivery, so the authoritative final drag/resize position is never lost
   * even if the gesture ends during a network blip.
   *
   * @param guaranteed whether these are authoritative commit emits that must be delivered
   */
  private flushCoalescedEmits(guaranteed: boolean): void {
    this.emitCoalescer.timer = null;
    this.emitCoalescer.lastTs = Date.now();
    if (this.emitCoalescer.pending.size === 0) {
      return;
    }
    if (!guaranteed && !this.transport.isConnected()) {
      // Keep pending: a dropped intermediate must not discard the latest geometry — the commit
      // flush (or next reconnect) still needs to deliver it.
      return;
    }
    this.emitCoalescer.pending.forEach(({ channel, payload }) => this.transport.emit(channel, payload, { guaranteed }));
    this.emitCoalescer.pending.clear();
  }

  /** Cancels any pending timer and flushes immediately with guaranteed delivery — call before an authoritative commit value. */
  private flushCoalescedEmitsNow(): void {
    if (this.emitCoalescer.timer != null) {
      clearTimeout(this.emitCoalescer.timer);
      this.emitCoalescer.timer = null;
    }
    this.flushCoalescedEmits(true);
  }

  moveCard(id: string, posX: number, posY: number): void {
    const cards = this.cards();
    const card = cards.find((c) => c.id === id);
    if (!card) {
      return;
    }
    const selected = this.selectedIds();
    const useSelection = selected.size > 1 && selected.has(id);
    const followIds = new Set<string>();
    if (card.groupId) {
      cards.forEach((c) => {
        if (c.groupId === card.groupId && c.id !== id) {
          followIds.add(c.id);
        }
      });
    }
    if (useSelection) {
      selected.forEach((sid) => {
        if (sid !== id) {
          followIds.add(sid);
        }
      });
    }
    cards.forEach((c) => {
      if (c.locked) {
        followIds.delete(c.id);
      }
    });

    const starts = this.cardDragStart;
    const gs = starts?.get(id);
    const dx = gs ? posX - gs.posX : posX - card.posX;
    const dy = gs ? posY - gs.posY : posY - card.posY;

    const nextPos = new Map<string, { posX: number; posY: number }>();
    nextPos.set(id, { posX, posY });
    followIds.forEach((fid) => {
      const base = starts?.get(fid) ?? cards.find((c) => c.id === fid);
      if (base) {
        nextPos.set(fid, { posX: base.posX + dx, posY: base.posY + dy });
      }
    });

    this.cards.update((prev) =>
      prev.map((c) => {
        const p = nextPos.get(c.id);
        return p ? { ...c, posX: p.posX, posY: p.posY } : c;
      }),
    );

    nextPos.forEach((p, cid) => this.moveEmit.pending.set(cid, p));
    this.scheduleMoveFlush();
  }

  startDragCard(id: string): void {
    const cards = this.cards();
    const card = cards.find((c) => c.id === id);
    if (!card) {
      return;
    }
    const selected = this.selectedIds();
    const useSelection = selected.size > 1 && selected.has(id);
    const movedIds = new Set<string>([id]);
    if (card.groupId) {
      cards.forEach((c) => {
        if (c.groupId === card.groupId) {
          movedIds.add(c.id);
        }
      });
    }
    if (useSelection) {
      selected.forEach((sid) => movedIds.add(sid));
    }
    cards.forEach((c) => {
      if (c.locked && c.id !== id) {
        movedIds.delete(c.id);
      }
    });
    this.cardDragStart = new Map(
      Array.from(movedIds).flatMap((cid) => {
        const c = cards.find((cc) => cc.id === cid);
        return c ? ([[cid, { posX: c.posX, posY: c.posY }]] as [string, { posX: number; posY: number }][]) : [];
      }),
    );
    this.markLocalControl(this.cardDragStart.keys());
  }

  commitDragCard(): void {
    if (this.moveEmit.timer != null) {
      clearTimeout(this.moveEmit.timer);
      this.moveEmit.timer = null;
    }
    this.flushMoveEmits();

    const starts = this.cardDragStart;
    this.cardDragStart = null;
    if (!starts) {
      return;
    }
    this.releaseLocalControl(starts.keys());
    const cards = this.cards();
    const ends = new Map<string, { posX: number; posY: number }>();
    starts.forEach((_, cid) => {
      const c = cards.find((cc) => cc.id === cid);
      if (c) {
        ends.set(cid, { posX: c.posX, posY: c.posY });
      }
    });
    let hasMoved = false;
    starts.forEach((start, cid) => {
      const end = ends.get(cid);
      if (end && (Math.abs(end.posX - start.posX) > 0.5 || Math.abs(end.posY - start.posY) > 0.5)) {
        hasMoved = true;
      }
    });
    if (!hasMoved) {
      return;
    }
    const applyMoves = (m: Map<string, { posX: number; posY: number }>) => {
      m.forEach(({ posX, posY }, cid) => {
        this.cards.update((prev) => prev.map((c) => (c.id === cid ? { ...c, posX, posY } : c)));
        this.transport.emit('card:move', { id: cid, boardId: this.boardId, posX, posY });
      });
    };
    this.pushHistory({ undo: () => applyMoves(starts), redo: () => applyMoves(ends) });
  }

  resizeCard(id: string, width: number, height: number): void {
    this.cards.update((prev) => prev.map((c) => (c.id === id ? { ...c, width, height } : c)));
    this.transport.emit('card:resize', { id, boardId: this.boardId, width, height });
  }

  resizeCardBox(id: string, box: CardBox): void {
    this.cards.update((prev) => prev.map((c) => (c.id === id ? { ...c, ...box } : c)));
    this.queueEmit('card:resize', id, { width: box.width, height: box.height });
    this.queueEmit('card:move', id, { posX: box.posX, posY: box.posY });
  }

  startResizeCard(id: string): void {
    const card = this.cards().find((c) => c.id === id);
    if (!card) {
      return;
    }
    this.cardResizeStart = { id, posX: card.posX, posY: card.posY, width: card.width, height: card.height };
    this.markLocalControl([id]);
  }

  commitResizeCard(id: string): void {
    this.flushCoalescedEmitsNow();
    const start = this.cardResizeStart;
    this.cardResizeStart = null;
    if (!start || start.id !== id) {
      return;
    }
    this.releaseLocalControl([id]);
    const card = this.cards().find((c) => c.id === id);
    if (!card) {
      return;
    }
    const before: CardBox = { posX: start.posX, posY: start.posY, width: start.width, height: start.height };
    const after: CardBox = { posX: card.posX, posY: card.posY, width: card.width, height: card.height };
    if (
      Math.abs(after.width - before.width) < 0.5 &&
      Math.abs(after.height - before.height) < 0.5 &&
      Math.abs(after.posX - before.posX) < 0.5 &&
      Math.abs(after.posY - before.posY) < 0.5
    ) {
      return;
    }
    const apply = (b: CardBox) => {
      this.cards.update((prev) => prev.map((c) => (c.id === id ? { ...c, ...b } : c)));
      this.transport.emit('card:resize', { id, boardId: this.boardId, width: b.width, height: b.height });
      this.transport.emit('card:move', { id, boardId: this.boardId, posX: b.posX, posY: b.posY });
    };
    this.pushHistory({ undo: () => apply(before), redo: () => apply(after) });
  }

  // ── Selection scaling (multi-select / group resize) ──────────────────────────
  startResizeSelection(ids: string[]): void {
    const wanted = new Set(ids);
    const map = new Map<string, CardBox>();
    this.cards().forEach((c) => {
      if (wanted.has(c.id) && !c.locked) {
        map.set(c.id, { posX: c.posX, posY: c.posY, width: c.width, height: c.height });
      }
    });
    this.selectionResizeStart = map.size >= 2 ? map : null;
  }

  scaleSelection(factor: number, anchorX: number, anchorY: number): void {
    const starts = this.selectionResizeStart;
    if (!starts) {
      return;
    }
    const next = new Map<string, CardBox>();
    starts.forEach((s, id) => {
      next.set(id, {
        posX: anchorX + (s.posX - anchorX) * factor,
        posY: anchorY + (s.posY - anchorY) * factor,
        width: s.width * factor,
        height: s.height * factor,
      });
    });
    this.cards.update((prev) =>
      prev.map((c) => {
        const b = next.get(c.id);
        return b ? { ...c, ...b } : c;
      }),
    );
    const now = Date.now();
    if (now - this.selResizeEmitTs > 60) {
      this.selResizeEmitTs = now;
      next.forEach((b, id) => {
        this.transport.emit('card:resize', { id, boardId: this.boardId, width: b.width, height: b.height });
        this.transport.emit('card:move', { id, boardId: this.boardId, posX: b.posX, posY: b.posY });
      });
    }
  }

  commitResizeSelection(): void {
    const starts = this.selectionResizeStart;
    this.selectionResizeStart = null;
    if (!starts) {
      return;
    }
    const cards = this.cards();
    const ends = new Map<string, CardBox>();
    starts.forEach((_, id) => {
      const c = cards.find((cc) => cc.id === id);
      if (c) {
        ends.set(id, { posX: c.posX, posY: c.posY, width: c.width, height: c.height });
      }
    });
    const apply = (boxes: Map<string, CardBox>) => {
      boxes.forEach((b, id) => {
        this.cards.update((prev) => prev.map((c) => (c.id === id ? { ...c, ...b } : c)));
        this.transport.emit('card:resize', { id, boardId: this.boardId, width: b.width, height: b.height });
        this.transport.emit('card:move', { id, boardId: this.boardId, posX: b.posX, posY: b.posY });
      });
    };
    let changed = false;
    starts.forEach((s, id) => {
      const e = ends.get(id);
      if (
        e &&
        (Math.abs(e.width - s.width) > 0.5 ||
          Math.abs(e.height - s.height) > 0.5 ||
          Math.abs(e.posX - s.posX) > 0.5 ||
          Math.abs(e.posY - s.posY) > 0.5)
      ) {
        changed = true;
      }
    });
    apply(ends);
    if (changed) {
      this.pushHistory({ undo: () => apply(starts), redo: () => apply(ends) });
    }
  }

  /**
   * Repaints a card's `content` **locally only**, with no emission — for a live gesture that needs
   * the card redrawn on every move but must not flood the room with one message per pixel. The
   * gesture is responsible for calling {@link updateCard} on release to make it real.
   *
   * Same local-now / emit-on-commit split as {@link resizeCardBox} + {@link commitResizeCard}.
   */
  previewCardContent(id: string, content: string): void {
    this.cards.update((prev) => prev.map((c) => (c.id === id ? { ...c, content } : c)));
  }

  /**
   * Aligns the text of every selected TEXT/LABEL card.
   *
   * `align` already existed on a TEXT card's format and was already rendered — nothing ever let a
   * user change it. LABEL gained the same field so both types answer to one control.
   */
  alignSelectedText(align: TextAlign): void {
    const cards = this.cards();
    this.unlockedSelectedIds()
      .map((id) => cards.find((c) => c.id === id))
      .filter((c): c is Card => !!c && (c.type === 'TEXT' || c.type === 'LABEL'))
      .forEach((card) => {
        const content =
          card.type === 'LABEL'
            ? serializeLabelFmt({ ...parseLabelFmt(card.content), align })
            : serializeTextFmt({ ...parseTextFmt(card.content), align });
        this.updateCard(card.id, content);
      });
  }

  /**
   * Repaints the fill of every selected SHAPE. A shape's fill lives inside its encoded `content`
   * (`kind|stroke|fill|…`), not in `card.color` — which is why the selection toolbar's colour
   * swatch, which drives `card.color`, could never change it.
   *
   * @param fill Hex colour, or `null` for no fill (outline only — the SHAPE default).
   */
  fillSelectedShapes(fill: string | null): void {
    const cards = this.cards();
    this.unlockedSelectedIds()
      .map((id) => cards.find((c) => c.id === id))
      .filter((c): c is Card => !!c && c.type === 'SHAPE')
      .forEach((card) => this.updateCard(card.id, serializeShape({ ...parseShape(card.content), fill })));
  }

  /**
   * @param previousContent The content to record as the undo target. Needed when a gesture already
   *                        repainted the card locally through {@link previewCardContent}: the card
   *                        now *holds* the new content, so reading it here would compare a value
   *                        with itself and emit nothing.
   */
  updateCard(id: string, content: string, previousContent?: string): void {
    const oldContent = previousContent ?? this.cards().find((c) => c.id === id)?.content ?? '';
    if (oldContent === content) {
      return;
    }
    this.pushHistory({
      undo: () => this.transport.emit('card:update', { id, boardId: this.boardId, content: oldContent }),
      redo: () => this.transport.emit('card:update', { id, boardId: this.boardId, content }),
    });
    this.transport.emit('card:update', { id, boardId: this.boardId, content });
  }

  deleteCard(id: string): void {
    const card = this.cards().find((c) => c.id === id);
    if (!card) {
      return;
    }
    const saved = { ...card };
    let trackedId = id;
    this.pushHistory({
      undo: () => {
        this.transport.emit('card:create', {
          boardId: this.boardId,
          content: saved.content,
          posX: saved.posX,
          posY: saved.posY,
          color: saved.color,
          type: saved.type,
          width: saved.width,
          height: saved.height,
        });
        this.pendingCardHistory.push((newCard: Card) => (trackedId = newCard.id));
      },
      redo: () => this.transport.emit('card:delete', { id: trackedId, boardId: this.boardId }),
    });
    this.transport.emit('card:delete', { id, boardId: this.boardId });
  }

  recolorCard(id: string, color: string): void {
    const oldColor = this.cards().find((c) => c.id === id)?.color ?? '';
    const apply = (col: string) => {
      this.cards.update((prev) => prev.map((c) => (c.id === id ? { ...c, color: col } : c)));
      this.transport.emit('card:recolor', { id, boardId: this.boardId, color: col });
    };
    this.pushHistory({ undo: () => apply(oldColor), redo: () => apply(color) });
    apply(color);
  }

  recolorSelected(color: string): void {
    const ids = this.unlockedSelectedIds();
    if (ids.length === 0) {
      return;
    }
    const cards = this.cards();
    const oldColors = new Map(ids.map((id) => [id, cards.find((cc) => cc.id === id)?.color ?? ''] as [string, string]));
    const applyOne = (id: string, col: string) => {
      this.cards.update((prev) => prev.map((c) => (c.id === id ? { ...c, color: col } : c)));
      this.transport.emit('card:recolor', { id, boardId: this.boardId, color: col });
    };
    this.pushHistory({
      undo: () => oldColors.forEach((col, id) => applyOne(id, col)),
      redo: () => ids.forEach((id) => applyOne(id, color)),
    });
    ids.forEach((id) => applyOne(id, color));
  }

  /**
   * Deletes every currently-selected, unlocked item — cards and/or connections alike
   * (US08.7.1: a selected connector must be deletable via Delete/Backspace exactly like a
   * card, without requiring mouse hover). `selectedIds` is a single shared signal for both
   * domains (see {@link selectCards}/{@link StructuredCanvasComponent#onConnectionSelect}), so
   * each id is resolved against both the current card list and the current connection list —
   * an id matching neither (e.g. already deleted by a concurrent remote mutation) is silently
   * skipped, consistent with every other silent-refusal mutation in this store.
   */
  deleteSelected(): void {
    const ids = this.unlockedSelectedIds();
    const cards = this.cards();
    const connections = this.connections();
    const frames = this.frames();
    const savedCards = ids.map((id) => cards.find((c) => c.id === id)).filter((c): c is Card => !!c);
    const connectionIds = ids.filter((id) => connections.some((c) => c.id === id));
    // Frames are selectable like cards (US08.8.1) — Delete must remove them too. Deleting a frame
    // never touches the cards it visually contains: containment is geometric, not a parent link.
    const frameIds = ids.filter((id) => frames.some((f) => f.id === id));
    if (savedCards.length === 0 && connectionIds.length === 0 && frameIds.length === 0) {
      return;
    }
    if (savedCards.length > 0) {
      const trackedIds = savedCards.map((c) => c.id);
      this.pushHistory({
        undo: () => {
          savedCards.forEach((card, i) => {
            this.transport.emit('card:create', {
              boardId: this.boardId,
              content: card.content,
              posX: card.posX,
              posY: card.posY,
              color: card.color,
              type: card.type,
              width: card.width,
              height: card.height,
            });
            this.pendingCardHistory.push((newCard: Card) => (trackedIds[i] = newCard.id));
          });
        },
        redo: () => trackedIds.forEach((id) => this.transport.emit('card:delete', { id, boardId: this.boardId })),
      });
      trackedIds.forEach((id) => this.transport.emit('card:delete', { id, boardId: this.boardId }));
    }
    // Each connection gets its own undo/redo history entry via deleteConnection — consistent
    // with how a lone connector delete (mouse-driven) already behaves.
    connectionIds.forEach((id) => this.deleteConnection(id));
    // Same per-item history convention for frames, via the existing deleteFrame.
    frameIds.forEach((id) => this.deleteFrame(id));
    this.selectedIds.set(new Set());
  }

  // ── Groups ─────────────────────────────────────────────────────────────────
  groupSelected(): void {
    const ids = Array.from(this.selectedIds());
    if (ids.length < 2) {
      return;
    }
    const selectedCards = this.cards().filter((c) => ids.includes(c.id));
    const groupIds = new Set(selectedCards.map((c) => c.groupId).filter(Boolean));
    const allSameGroup = groupIds.size === 1 && selectedCards.every((c) => c.groupId !== null);

    if (allSameGroup) {
      const existingGroupId = Array.from(groupIds)[0] as string;
      let trackedGroupId = existingGroupId;
      this.transport.emit('cards:ungroup', { boardId: this.boardId, groupId: existingGroupId });
      this.pushHistory({
        undo: () => {
          this.transport.emit('cards:group', { boardId: this.boardId, cardIds: ids });
          this.pendingGroupHistory.push((newGroupId) => (trackedGroupId = newGroupId));
        },
        redo: () => this.transport.emit('cards:ungroup', { boardId: this.boardId, groupId: trackedGroupId }),
      });
    } else {
      let trackedGroupId = '';
      this.pendingGroupHistory.push((newGroupId) => {
        trackedGroupId = newGroupId;
        this.pushHistory({
          undo: () => this.transport.emit('cards:ungroup', { boardId: this.boardId, groupId: trackedGroupId }),
          redo: () => {
            this.transport.emit('cards:group', { boardId: this.boardId, cardIds: ids });
            this.pendingGroupHistory.push((ngId) => (trackedGroupId = ngId));
          },
        });
      });
      this.transport.emit('cards:group', { boardId: this.boardId, cardIds: ids });
    }
  }

  ungroupById(groupId: string): void {
    const cardsInGroup = this.cards().filter((c) => c.groupId === groupId);
    if (cardsInGroup.length === 0) {
      this.transport.emit('cards:ungroup', { boardId: this.boardId, groupId });
      return;
    }
    const cardIds = cardsInGroup.map((c) => c.id);
    const savedColor = cardsInGroup[0].groupColor ?? null;
    let trackedGroupId = groupId;
    this.pushHistory({
      undo: () => {
        this.transport.emit('cards:group', { boardId: this.boardId, cardIds });
        this.pendingGroupHistory.push((newGroupId) => {
          trackedGroupId = newGroupId;
          if (savedColor) {
            this.transport.emit('cards:group-color', { boardId: this.boardId, groupId: newGroupId, color: savedColor });
          }
        });
      },
      redo: () => this.transport.emit('cards:ungroup', { boardId: this.boardId, groupId: trackedGroupId }),
    });
    this.transport.emit('cards:ungroup', { boardId: this.boardId, groupId });
  }

  recolorGroup(groupId: string, color: string): void {
    const oldColor = this.cards().find((c) => c.groupId === groupId)?.groupColor ?? null;
    if (oldColor === color) {
      return;
    }
    const apply = (col: string | null) => {
      this.cards.update((prev) => prev.map((c) => (c.groupId === groupId ? { ...c, groupColor: col } : c)));
      this.transport.emit('cards:group-color', { boardId: this.boardId, groupId, color: col });
    };
    apply(color);
    this.pushHistory({ undo: () => apply(oldColor), redo: () => apply(color) });
  }

  // ── Connections ──────────────────────────────────────────────────────────────
  private recreateConnection(conn: Connection, trackId: (id: string) => void): void {
    this.transport.emit('connection:create', { boardId: this.boardId, fromId: conn.fromId, toId: conn.toId });
    this.pendingConnHistory.push((created: Connection) => {
      trackId(created.id);
      this.transport.emit('connection:update', {
        id: created.id,
        boardId: this.boardId,
        label: conn.label,
        color: conn.color,
        shape: conn.shape,
        arrow: conn.arrow,
        dashed: conn.dashed,
        lineStyle: conn.lineStyle,
        startCap: conn.startCap,
        endCap: conn.endCap,
        width: conn.width,
      });
    });
  }

  /**
   * @param style Style picked in the toolbar before the connector was drawn (arrow, dashed…).
   *              Sent with the creation itself rather than patched in afterwards: the board is
   *              server-authoritative with no optimistic rendering, so a follow-up
   *              `connection:update` would show every participant a default-styled connector
   *              first, then visibly correct it. The server applies each field through the same
   *              whitelist as an update and ignores what it does not know, so an older backend
   *              simply creates the connector with its defaults (collaboratif-core#101).
   */
  addConnection(fromId: string, toId: string, style: ConnectionPatch = {}): void {
    const payload = { boardId: this.boardId, fromId, toId, ...style };
    this.transport.emit('connection:create', payload);
    this.pendingConnHistory.push((created: Connection) => {
      let trackedId = created.id;
      this.pushHistory({
        undo: () => this.transport.emit('connection:delete', { id: trackedId, boardId: this.boardId }),
        redo: () => {
          // Redo re-creates the connector with the same style it was born with, not the current
          // toolbar preset — undo/redo must replay history, not re-read live UI state.
          this.transport.emit('connection:create', payload);
          this.pendingConnHistory.push((again: Connection) => (trackedId = again.id));
        },
      });
    });
  }

  deleteConnection(id: string): void {
    const conn = this.connections().find((c) => c.id === id);
    if (!conn) {
      return;
    }
    let trackedId = id;
    this.pushHistory({
      undo: () => this.recreateConnection(conn, (newId) => (trackedId = newId)),
      redo: () => this.transport.emit('connection:delete', { id: trackedId, boardId: this.boardId }),
    });
    this.transport.emit('connection:delete', { id, boardId: this.boardId });
  }

  /**
   * Restyles an existing connector (US08.7.2) — emits `connection:update` as a **partial
   * patch**: only the keys present on {@link patch} are sent (`Object.keys`, so an omitted
   * field is never transmitted), while an explicitly-provided `label: null` *is* sent
   * (distinct from "absent" — the backend clears the label). Applies the patch optimistically
   * to local state, then relies on the `connection:updated` broadcast (see
   * {@link registerHandlers}) for full reconciliation. Pushes a single undo/redo history
   * entry restoring exactly the fields that were changed.
   */
  updateConnection(id: string, patch: ConnectionPatch): void {
    const conn = this.connections().find((c) => c.id === id);
    if (!conn) {
      return;
    }
    const before: ConnectionPatch = {};
    (Object.keys(patch) as (keyof ConnectionPatch)[]).forEach((k) => {
      (before as Record<string, unknown>)[k] = conn[k];
    });
    const apply = (p: ConnectionPatch) => {
      this.connections.update((prev) => prev.map((c) => (c.id === id ? { ...c, ...p } : c)));
      this.transport.emit('connection:update', { id, boardId: this.boardId, ...p });
    };
    apply(patch);
    this.pushHistory({ undo: () => apply(before), redo: () => apply(patch) });
  }

  // ── Frames ─────────────────────────────────────────────────────────────────
  addFrame(posX: number, posY: number): void {
    const emitParams = { boardId: this.boardId, posX, posY };
    this.pendingFrameHistory.push((frame: Frame) => {
      let trackedId = frame.id;
      this.pushHistory({
        undo: () => this.transport.emit('frame:delete', { id: trackedId, boardId: this.boardId }),
        redo: () => {
          this.transport.emit('frame:create', emitParams);
          this.pendingFrameHistory.push((newFrame: Frame) => (trackedId = newFrame.id));
        },
      });
    });
    this.transport.emit('frame:create', emitParams);
  }

  moveFrame(
    id: string,
    posX: number,
    posY: number,
    capturedCards: { id: string; startX: number; startY: number; frameStartX: number; frameStartY: number }[],
  ): void {
    this.frames.update((prev) => prev.map((f) => (f.id === id ? { ...f, posX, posY } : f)));
    this.queueEmit('frame:move', id, { posX, posY });

    if (capturedCards.length === 0) {
      return;
    }
    const { frameStartX, frameStartY } = capturedCards[0];
    const dx = posX - frameStartX;
    const dy = posY - frameStartY;
    this.cards.update((prev) =>
      prev.map((c) => {
        const cap = capturedCards.find((cc) => cc.id === c.id);
        if (!cap) {
          return c;
        }
        const newX = cap.startX + dx;
        const newY = cap.startY + dy;
        this.queueEmit('card:move', c.id, { posX: newX, posY: newY });
        return { ...c, posX: newX, posY: newY };
      }),
    );
  }

  startDragFrame(id: string, capturedCardIds: string[]): void {
    const frame = this.frames().find((f) => f.id === id);
    if (!frame) {
      return;
    }
    const cards = this.cards();
    this.frameDragStart = {
      frameId: id,
      framePos: { posX: frame.posX, posY: frame.posY },
      cardPositions: new Map(
        capturedCardIds.flatMap((cid) => {
          const c = cards.find((cc) => cc.id === cid);
          return c ? ([[cid, { posX: c.posX, posY: c.posY }]] as [string, { posX: number; posY: number }][]) : [];
        }),
      ),
    };
  }

  commitDragFrame(id: string): void {
    this.flushCoalescedEmitsNow();
    const start = this.frameDragStart;
    this.frameDragStart = null;
    if (!start || start.frameId !== id) {
      return;
    }
    const frame = this.frames().find((f) => f.id === id);
    if (!frame) {
      return;
    }
    const oldPos = start.framePos;
    const newPos = { posX: frame.posX, posY: frame.posY };
    if (Math.abs(newPos.posX - oldPos.posX) < 0.5 && Math.abs(newPos.posY - oldPos.posY) < 0.5) {
      return;
    }
    const cards = this.cards();
    const newCardPositions = new Map<string, { posX: number; posY: number }>();
    start.cardPositions.forEach((_, cid) => {
      const c = cards.find((cc) => cc.id === cid);
      if (c) {
        newCardPositions.set(cid, { posX: c.posX, posY: c.posY });
      }
    });
    const apply = (fp: { posX: number; posY: number }, cardPos: Map<string, { posX: number; posY: number }>) => {
      this.frames.update((prev) => prev.map((f) => (f.id === id ? { ...f, ...fp } : f)));
      this.transport.emit('frame:move', { id, boardId: this.boardId, ...fp });
      cardPos.forEach(({ posX, posY }, cid) => {
        this.cards.update((prev) => prev.map((c) => (c.id === cid ? { ...c, posX, posY } : c)));
        this.transport.emit('card:move', { id: cid, boardId: this.boardId, posX, posY });
      });
    };
    this.pushHistory({
      undo: () => apply(oldPos, start.cardPositions),
      redo: () => apply(newPos, newCardPositions),
    });
  }

  resizeFrameBox(id: string, posX: number, posY: number, width: number, height: number): void {
    this.frames.update((prev) => prev.map((f) => (f.id === id ? { ...f, posX, posY, width, height } : f)));
    this.queueEmit('frame:move', id, { posX, posY });
    this.queueEmit('frame:resize', id, { width, height });
  }

  startResizeFrame(id: string): void {
    const frame = this.frames().find((f) => f.id === id);
    if (!frame) {
      return;
    }
    this.frameResizeStart = { id, posX: frame.posX, posY: frame.posY, width: frame.width, height: frame.height };
  }

  commitResizeFrame(id: string): void {
    this.flushCoalescedEmitsNow();
    const start = this.frameResizeStart;
    this.frameResizeStart = null;
    if (!start || start.id !== id) {
      return;
    }
    const frame = this.frames().find((f) => f.id === id);
    if (!frame) {
      return;
    }
    const old: CardBox = { posX: start.posX, posY: start.posY, width: start.width, height: start.height };
    const next: CardBox = { posX: frame.posX, posY: frame.posY, width: frame.width, height: frame.height };
    if (
      Math.abs(next.width - old.width) < 0.5 &&
      Math.abs(next.height - old.height) < 0.5 &&
      Math.abs(next.posX - old.posX) < 0.5 &&
      Math.abs(next.posY - old.posY) < 0.5
    ) {
      return;
    }
    const apply = (b: CardBox) => {
      this.frames.update((prev) => prev.map((f) => (f.id === id ? { ...f, ...b } : f)));
      this.transport.emit('frame:move', { id, boardId: this.boardId, posX: b.posX, posY: b.posY });
      this.transport.emit('frame:resize', { id, boardId: this.boardId, width: b.width, height: b.height });
    };
    this.pushHistory({ undo: () => apply(old), redo: () => apply(next) });
  }

  updateFrame(id: string, title: string): void {
    const oldTitle = this.frames().find((f) => f.id === id)?.title ?? '';
    if (oldTitle === title) {
      return;
    }
    this.pushHistory({
      undo: () => this.transport.emit('frame:update', { id, boardId: this.boardId, title: oldTitle }),
      redo: () => this.transport.emit('frame:update', { id, boardId: this.boardId, title }),
    });
    this.transport.emit('frame:update', { id, boardId: this.boardId, title });
  }

  setFrameActive(id: string, active: boolean): void {
    const old = this.frames().find((f) => f.id === id)?.active ?? false;
    if (old === active) {
      return;
    }
    const apply = (a: boolean) => {
      this.frames.update((prev) => prev.map((f) => (f.id === id ? { ...f, active: a } : f)));
      this.transport.emit('frame:update', { id, boardId: this.boardId, active: a });
    };
    apply(active);
    this.pushHistory({ undo: () => apply(old), redo: () => apply(active) });
  }

  deleteFrame(id: string): void {
    const frame = this.frames().find((f) => f.id === id);
    if (!frame) {
      return;
    }
    const saved = { ...frame };
    let trackedId = id;
    this.pushHistory({
      undo: () => {
        this.transport.emit('frame:create', { boardId: this.boardId, posX: saved.posX, posY: saved.posY });
        this.pendingFrameHistory.push((newFrame: Frame) => (trackedId = newFrame.id));
      },
      redo: () => this.transport.emit('frame:delete', { id: trackedId, boardId: this.boardId }),
    });
    this.transport.emit('frame:delete', { id, boardId: this.boardId });
  }

  // ── Reset ─────────────────────────────────────────────────────────────────
  private restoreSnapshot(cards: Card[], conns: Connection[], frames: Frame[]): void {
    const idMap = new Map<string, string>();
    let remaining = cards.length;
    cards.forEach((c) => {
      this.pendingCardHistory.push((newCard: Card) => {
        idMap.set(c.id, newCard.id);
        remaining--;
        if (remaining === 0) {
          conns.forEach((cn) => {
            const fromId = idMap.get(cn.fromId);
            const toId = idMap.get(cn.toId);
            if (fromId && toId) {
              this.transport.emit('connection:create', { boardId: this.boardId, fromId, toId });
            }
          });
        }
      });
      this.transport.emit('card:create', {
        boardId: this.boardId,
        content: c.content,
        posX: c.posX,
        posY: c.posY,
        color: c.color,
        type: c.type,
        width: c.width,
        height: c.height,
        layer: c.layer,
        groupId: c.groupId,
        groupColor: c.groupColor,
        locked: c.locked,
      });
    });
    frames.forEach((f) =>
      this.transport.emit('frame:create', {
        boardId: this.boardId,
        posX: f.posX,
        posY: f.posY,
        title: f.title,
        color: f.color,
        width: f.width,
        height: f.height,
      }),
    );
  }

  resetBoard(): void {
    const snapCards = this.cards().map((c) => ({ ...c }));
    const snapConns = this.connections().map((c) => ({ ...c }));
    const snapFrames = this.frames().map((f) => ({ ...f }));
    if (snapCards.length > 0 || snapConns.length > 0 || snapFrames.length > 0) {
      this.pushHistory({
        undo: () => this.restoreSnapshot(snapCards, snapConns, snapFrames),
        redo: () => this.transport.emit('board:reset', { boardId: this.boardId }),
      });
    }
    this.transport.emit('board:reset', { boardId: this.boardId });
    this.selectedIds.set(new Set());
  }

  // ── Board fields ─────────────────────────────────────────────────────────────
  createField(name: string, type: string, options?: string[], emoji?: string): void {
    this.transport.emit('boardfield:create', {
      boardId: this.boardId,
      name,
      emoji: emoji ?? null,
      type,
      options: options ?? null,
      order: this.fields().length,
    });
  }
  updateField(id: string, name: string, options?: string[], emoji?: string): void {
    this.transport.emit('boardfield:update', { id, boardId: this.boardId, name, emoji: emoji ?? null, options: options ?? null });
  }
  deleteField(id: string): void {
    this.transport.emit('boardfield:delete', { id, boardId: this.boardId });
  }
  setFieldValue(cardId: string, fieldId: string, value: string): void {
    if (value.trim() === '') {
      this.transport.emit('cardfield:clear', { boardId: this.boardId, cardId, fieldId });
    } else {
      this.transport.emit('cardfield:set', { boardId: this.boardId, cardId, fieldId, value: value.trim() });
    }
  }
  clearFieldValue(cardId: string, fieldId: string): void {
    this.transport.emit('cardfield:clear', { boardId: this.boardId, cardId, fieldId });
  }

  // ── Timer & vote ─────────────────────────────────────────────────────────────
  startTimer(duration: number): void {
    this.transport.emit('timer:start', { boardId: this.boardId, duration });
  }
  stopTimer(): void {
    this.transport.emit('timer:stop', { boardId: this.boardId });
  }
  startVote(config: { votesPerPerson: number; timerSeconds: number | null; voterIds: string[] }): void {
    this.transport.emit('vote:start', { boardId: this.boardId, ...config });
  }
  castVote(cardId: string): void {
    const s = this.activeVoteSession();
    if (!s) {
      return;
    }
    // Enforce the per-person budget client-side so a cast never gets silently dropped server-side
    // (US08.12.2). The server remains the authority — this only avoids no-op round-trips.
    if (this.myVotesUsed() >= s.votesPerPerson) {
      return;
    }
    this.transport.emit('vote:cast', { sessionId: s.id, boardId: this.boardId, cardId });
  }
  uncastVote(cardId: string): void {
    const s = this.activeVoteSession();
    if (!s) {
      return;
    }
    // Only un-cast a card the current user has actually voted for (US08.12.2).
    if ((this.myVoteTallyByCard().get(cardId) ?? 0) <= 0) {
      return;
    }
    this.transport.emit('vote:uncast', { sessionId: s.id, boardId: this.boardId, cardId });
  }
  stopVote(): void {
    const s = this.activeVoteSession();
    if (!s) {
      return;
    }
    this.transport.emit('vote:stop', { sessionId: s.id, boardId: this.boardId });
  }
  extendVote(extraSeconds: number): void {
    const s = this.activeVoteSession();
    if (!s) {
      return;
    }
    this.transport.emit('vote:extend', { sessionId: s.id, boardId: this.boardId, extraSeconds });
  }

  // ── Board info ─────────────────────────────────────────────────────────────
  async updateBoardInfo(input: {
    name?: string;
    description?: string | null;
    coverImage?: string | null;
    maxParticipants?: number | null;
    enabledActivities?: string[] | null;
  }): Promise<BoardDetail> {
    const updated = await firstValueFrom(
      this.http.patch<BoardDetail>(`${this.apiUrl}/whiteboard/boards/${this.boardId}`, input),
    );
    this.board.update((prev) => (prev ? { ...prev, ...updated } : prev));
    return updated;
  }

  /**
   * Syncs the loaded board detail with metadata saved through the settings modal (US08.2.4).
   *
   * <p>The modal persists via {@code BoardService.updateBoardSettings} directly rather than
   * through {@link #updateBoardInfo}, so the store never learns about the change on its own —
   * without this call the header title and a reopened settings modal keep showing the stale
   * pre-save values until a full page reload. Maps the list-shaped {@code title} back onto the
   * board detail's {@code name}.
   */
  applySavedMetadata(meta: {
    title: string;
    description: string | null;
    coverImage: string | null;
    maxParticipants: number | null;
    enabledActivities: string[];
  }): void {
    this.board.update((prev) =>
      prev
        ? {
            ...prev,
            name: meta.title,
            description: meta.description,
            coverImage: meta.coverImage,
            maxParticipants: meta.maxParticipants,
            enabledActivities: meta.enabledActivities,
          }
        : prev,
    );
  }

  // ── Layers ─────────────────────────────────────────────────────────────────
  setCardLayer(id: string, layer: number): void {
    const oldLayer = this.cards().find((c) => c.id === id)?.layer ?? 1;
    if (oldLayer === layer) {
      return;
    }
    const apply = (l: number) => {
      this.cards.update((prev) => prev.map((c) => (c.id === id ? { ...c, layer: l } : c)));
      this.transport.emit('card:layer', { id, boardId: this.boardId, layer: l });
    };
    apply(layer);
    this.pushHistory({ undo: () => apply(oldLayer), redo: () => apply(layer) });
  }

  setFrameLayer(id: string, layer: number): void {
    const oldLayer = this.frames().find((f) => f.id === id)?.layer ?? 1;
    if (oldLayer === layer) {
      return;
    }
    const apply = (l: number) => {
      this.frames.update((prev) => prev.map((f) => (f.id === id ? { ...f, layer: l } : f)));
      this.transport.emit('frame:layer', { id, boardId: this.boardId, layer: l });
    };
    apply(layer);
    this.pushHistory({ undo: () => apply(oldLayer), redo: () => apply(layer) });
  }

  setLayerSelected(layer: number): void {
    const ids = Array.from(this.selectedIds());
    if (ids.length === 0) {
      return;
    }
    const cards = this.cards();
    const oldLayers = new Map(ids.map((id) => [id, cards.find((cc) => cc.id === id)?.layer ?? 1] as [string, number]));
    if ([...oldLayers.values()].every((l) => l === layer)) {
      return;
    }
    const apply = (resolve: (id: string) => number) => {
      this.cards.update((prev) => prev.map((c) => (ids.includes(c.id) ? { ...c, layer: resolve(c.id) } : c)));
      ids.forEach((id) => this.transport.emit('card:layer', { id, boardId: this.boardId, layer: resolve(id) }));
    };
    apply(() => layer);
    this.pushHistory({
      undo: () => apply((id) => oldLayers.get(id) ?? 1),
      redo: () => apply(() => layer),
    });
  }

  // ── Lock ─────────────────────────────────────────────────────────────────
  lockCards(ids: string[], locked: boolean): void {
    const cards = this.cards();
    const prevLocked = new Map(ids.map((id) => [id, cards.find((cc) => cc.id === id)?.locked ?? false] as [string, boolean]));
    this.transport.emit('card:lock', { ids, boardId: this.boardId, locked });
    this.pushHistory({
      undo: () => {
        const toLock = ids.filter((id) => prevLocked.get(id) === true);
        const toUnlock = ids.filter((id) => prevLocked.get(id) === false);
        if (toLock.length) {
          this.transport.emit('card:lock', { ids: toLock, boardId: this.boardId, locked: true });
        }
        if (toUnlock.length) {
          this.transport.emit('card:lock', { ids: toUnlock, boardId: this.boardId, locked: false });
        }
      },
      redo: () => this.transport.emit('card:lock', { ids, boardId: this.boardId, locked }),
    });
  }

  lockSelected(locked: boolean): void {
    const cards = this.cards();
    const ids = Array.from(this.selectedIds()).filter((id) => cards.find((c) => c.id === id)?.type !== 'DRAW');
    if (ids.length === 0) {
      return;
    }
    this.lockCards(ids, locked);
  }

  // ── Batch positioning ──────────────────────────────────────────────────────
  private setCardPositions(targets: { id: string; posX: number; posY: number }[]): void {
    if (targets.length === 0) {
      return;
    }
    const cards = this.cards();
    const before = new Map<string, { posX: number; posY: number }>();
    targets.forEach((t) => {
      const c = cards.find((cc) => cc.id === t.id);
      if (c) {
        before.set(t.id, { posX: c.posX, posY: c.posY });
      }
    });
    const after = new Map(targets.map((t) => [t.id, { posX: t.posX, posY: t.posY }]));
    const apply = (m: Map<string, { posX: number; posY: number }>) => {
      this.cards.update((prev) => prev.map((c) => (m.has(c.id) ? { ...c, ...m.get(c.id)! } : c)));
      m.forEach((p, id) => this.transport.emit('card:move', { id, boardId: this.boardId, posX: p.posX, posY: p.posY }));
    };
    apply(after);
    let changed = false;
    before.forEach((b, id) => {
      const a = after.get(id)!;
      if (Math.abs(a.posX - b.posX) > 0.5 || Math.abs(a.posY - b.posY) > 0.5) {
        changed = true;
      }
    });
    if (!changed) {
      return;
    }
    this.pushHistory({ undo: () => apply(before), redo: () => apply(after) });
  }

  moveSelectedBy(dx: number, dy: number): void {
    const cards = this.cards();
    const targets = Array.from(this.selectedIds()).flatMap((id) => {
      const c = cards.find((cc) => cc.id === id);
      return c && !c.locked ? [{ id, posX: c.posX + dx, posY: c.posY + dy }] : [];
    });
    this.setCardPositions(targets);
  }

  arrangeSelected(layout: 'row' | 'column' | 'grid'): void {
    const cards = this.cards();
    const sel = this.unlockedSelectedIds().flatMap((id) => {
      const c = cards.find((cc) => cc.id === id);
      return c ? [c] : [];
    });
    if (sel.length < 2) {
      return;
    }
    const GAP = 24;
    const minX = Math.min(...sel.map((c) => c.posX));
    const minY = Math.min(...sel.map((c) => c.posY));
    const ordered = [...sel].sort((a, b) => a.posY - b.posY || a.posX - b.posX);
    const targets: { id: string; posX: number; posY: number }[] = [];
    if (layout === 'row') {
      let x = minX;
      for (const c of ordered) {
        targets.push({ id: c.id, posX: x, posY: minY });
        x += c.width + GAP;
      }
    } else if (layout === 'column') {
      let y = minY;
      for (const c of ordered) {
        targets.push({ id: c.id, posX: minX, posY: y });
        y += c.height + GAP;
      }
    } else {
      const cols = Math.ceil(Math.sqrt(ordered.length));
      const colW = Math.max(...sel.map((c) => c.width)) + GAP;
      const rowH = Math.max(...sel.map((c) => c.height)) + GAP;
      ordered.forEach((c, i) => {
        targets.push({ id: c.id, posX: minX + (i % cols) * colW, posY: minY + Math.floor(i / cols) * rowH });
      });
    }
    this.setCardPositions(targets);
  }

  pasteCards(clipCards: ClipboardCard[], canvasX: number, canvasY: number): void {
    if (clipCards.length === 0) {
      return;
    }
    const minX = Math.min(...clipCards.map((c) => c.posX));
    const minY = Math.min(...clipCards.map((c) => c.posY));
    const maxX = Math.max(...clipCards.map((c) => c.posX + c.width));
    const maxY = Math.max(...clipCards.map((c) => c.posY + c.height));
    const dx = canvasX - (minX + maxX) / 2;
    const dy = canvasY - (minY + maxY) / 2;

    const groupMap = new Map<string, number[]>();
    clipCards.forEach((c, i) => {
      if (c.groupId) {
        const arr = groupMap.get(c.groupId) ?? [];
        arr.push(i);
        groupMap.set(c.groupId, arr);
      }
    });
    const groupsToDo = [...groupMap.entries()].filter(([, idxs]) => idxs.length >= 2);
    let currentIds: string[] = [];

    const spawnCards = (onAllCreated: (ids: string[]) => void) => {
      const ids = new Array<string>(clipCards.length).fill('');
      let remaining = clipCards.length;
      clipCards.forEach((c, i) => {
        this.pendingCardHistory.push((card: Card) => {
          ids[i] = card.id;
          remaining--;
          if (remaining === 0) {
            onAllCreated(ids);
          }
        });
        this.transport.emit('card:create', {
          boardId: this.boardId,
          posX: c.posX + dx,
          posY: c.posY + dy,
          type: c.type,
          content: c.content,
          color: c.color,
          width: c.width,
          height: c.height,
          layer: c.layer ?? 1,
        });
      });
    };

    const regroup = (newIds: string[]) => {
      groupsToDo.forEach(([, idxs]) => {
        const cardIds = idxs.map((idx) => newIds[idx]).filter(Boolean);
        if (cardIds.length < 2) {
          return;
        }
        const groupCol = clipCards[idxs[0]].groupColor;
        this.pendingGroupHistory.push((newGroupId) => {
          if (groupCol) {
            this.transport.emit('cards:group-color', { boardId: this.boardId, groupId: newGroupId, color: groupCol });
          }
        });
        this.transport.emit('cards:group', { boardId: this.boardId, cardIds });
      });
    };

    spawnCards((ids) => {
      currentIds = ids;
      regroup(ids);
      this.pushHistory({
        undo: () => currentIds.forEach((id) => this.transport.emit('card:delete', { id, boardId: this.boardId })),
        redo: () =>
          spawnCards((redoIds) => {
            currentIds = redoIds;
            regroup(redoIds);
          }),
      });
    });
  }

  /**
   * Copies the currently selected cards to the clipboard (in-memory + localStorage mirror).
   * Connections and frames are ignored — only cards are portable. Returns the number of cards
   * copied (0 when the selection holds no card), so callers can surface a toast/label.
   */
  copySelected(): number {
    const selected = this.selectedIds();
    if (selected.size === 0) {
      return 0;
    }
    const clip: ClipboardCard[] = this.cards()
      .filter((c) => selected.has(c.id))
      .map((c) => ({
        type: c.type,
        content: c.content,
        color: c.color,
        posX: c.posX,
        posY: c.posY,
        width: c.width,
        height: c.height,
        layer: c.layer ?? 1,
        groupId: c.groupId,
        groupColor: c.groupColor,
      }));
    if (clip.length === 0) {
      return 0;
    }
    this.clipboard.set(clip);
    this.pasteOffset = 0;
    try {
      localStorage.setItem(CLIPBOARD_STORAGE_KEY, JSON.stringify(clip));
    } catch {
      // Quota exceeded or storage denied (private mode) — the in-memory clipboard still works.
    }
    return clip.length;
  }

  /**
   * Cut (Ctrl+X): copies the selection to the clipboard, then removes it — plain
   * {@link copySelected} followed by {@link deleteSelected}, so both keep their existing
   * semantics and undo restores everything.
   *
   * <p>Only cards are clipboard-portable ({@link ClipboardCard}): a connection or a frame caught
   * in the selection is removed with it but cannot be pasted back — undo is the way back. Cutting
   * a frame never removes the cards it visually contains (containment is geometric).
   *
   * @return the number of cards placed on the clipboard
   */
  cutSelected(): number {
    const copied = this.copySelected();
    this.deleteSelected();
    return copied;
  }

  /**
   * Pastes the clipboard cards onto the board, cascading each successive paste by
   * {@link PASTE_OFFSET_STEP} so they don't stack exactly. Falls back to the localStorage mirror
   * when the in-memory clipboard is empty (e.g. after a board switch). No-op when both are empty.
   */
  pasteFromClipboard(): void {
    let clip = this.clipboard();
    if (clip.length === 0) {
      try {
        const raw = localStorage.getItem(CLIPBOARD_STORAGE_KEY);
        if (raw) {
          clip = JSON.parse(raw) as ClipboardCard[];
          this.clipboard.set(clip);
        }
      } catch {
        // Malformed/absent mirror — nothing to paste.
      }
    }
    if (clip.length === 0) {
      return;
    }
    const minX = Math.min(...clip.map((c) => c.posX));
    const minY = Math.min(...clip.map((c) => c.posY));
    const maxX = Math.max(...clip.map((c) => c.posX + c.width));
    const maxY = Math.max(...clip.map((c) => c.posY + c.height));
    this.pasteOffset += PASTE_OFFSET_STEP;
    this.pasteCards(clip, (minX + maxX) / 2 + this.pasteOffset, (minY + maxY) / 2 + this.pasteOffset);
  }

  /** Copies the current selection and immediately pastes it, offset — the Ctrl+D convenience path. */
  duplicateSelected(): void {
    if (this.copySelected() === 0) {
      return;
    }
    this.pasteFromClipboard();
  }

  // ── Cursor ─────────────────────────────────────────────────────────────────
  emitCursor(x: number, y: number): void {
    const now = Date.now();
    if (now - this.cursorThrottleTs < CURSOR_THROTTLE_MS) {
      return;
    }
    this.cursorThrottleTs = now;
    this.transport.emit('board:cursor', { boardId: this.boardId, x, y });
  }
}
