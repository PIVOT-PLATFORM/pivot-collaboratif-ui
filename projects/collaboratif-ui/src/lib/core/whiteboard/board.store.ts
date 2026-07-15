import { Injectable, computed, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { firstValueFrom, timeout } from 'rxjs';
import { COLLABORATIF_API_URL } from './config/tokens';
import { BoardTransport } from './board-transport';
import { ToastService } from '../toast/toast.service';
import { DEFAULT_CARD_COLOR } from '../../whiteboard/model/colors';
import { HISTORY_LIMIT, CURSOR_THROTTLE_MS } from '../../whiteboard/model/board-constants';
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

  readonly isReadonly = computed(() => this.userRole() === 'VIEWER');

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
  /** Id of a freshly self-created card that should open in edit mode (one-shot). */
  readonly autoEditCardId = signal<string | null>(null);
  private readonly pendingCardHistory: Array<(card: Card) => void> = [];
  private readonly pendingConnHistory: Array<(conn: Connection) => void> = [];
  private readonly pendingFrameHistory: Array<(frame: Frame) => void> = [];
  private readonly pendingGroupHistory: Array<(groupId: string) => void> = [];

  private cardDragStart: Map<string, { posX: number; posY: number }> | null = null;
  private readonly moveEmit = { raf: null as number | null, pending: new Map<string, { posX: number; posY: number }>() };
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

  // ── Lifecycle ─────────────────────────────────────────────────────────────────
  /** Loads the board over REST and opens the realtime room. Call once from the container. */
  init(boardId: string): void {
    this.boardId = boardId;
    void this.loadBoard();
    void this.loadMembers();
    void this.loadVote('current', this.activeVoteSession);
    void this.loadVote('last', this.lastVoteSession);
    this.transport.connect(boardId);
    this.transport.emit('board:join', boardId);
    this.unsubscribers.push(this.transport.onReconnect(() => this.transport.emit('board:join', boardId)));
    this.registerHandlers();
  }

  /** Leaves the room and tears down subscriptions. Call from the container's ngOnDestroy. */
  destroy(): void {
    if (this.moveEmit.raf != null) {
      cancelAnimationFrame(this.moveEmit.raf);
      this.moveEmit.raf = null;
    }
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
      // ⚠️ WIP: vote endpoints not implemented in collaboratif-core yet.
      const session = await firstValueFrom(
        this.http.get<VoteSession | null>(`${this.apiUrl}/whiteboard/boards/${this.boardId}/vote/${which}`),
      );
      if (session) {
        target.set(session);
      }
    } catch {
      /* endpoint absent — WIP */
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
        this.cards.set(cards);
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

    this.on<VoteSession>('vote:session:started', (s) => this.activeVoteSession.set(s));
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
      const { clientTag, ...card } = payload;
      if (clientTag && this.pendingLocalTags.delete(clientTag)) {
        this.autoEditCardId.set(card.id);
      }
      this.pendingCardHistory.shift()?.(card as Card);
      this.cards.update((prev) => [...prev, { ...(card as Card), fieldValues: [] }]);
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
      this.cards.update((prev) => prev.map((c) => (c.id === card.id ? { ...c, ...card } : c)));
    });
    this.on<Card & { senderSessionId?: string }>('card:resized', (payload) => {
      const { senderSessionId, ...card } = payload;
      if (senderSessionId && senderSessionId === this.transport.getSessionId()) {
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
      this.frames.update((prev) => [...prev, frame]);
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

    this.on<BoardField>('boardfield:created', (field) => this.fields.update((prev) => [...prev, field]));
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
    this.transport.emit('card:create', { ...emitParams, clientTag });
  }

  private flushMoveEmits(): void {
    this.moveEmit.raf = null;
    const pending = this.moveEmit.pending;
    if (pending.size === 0) {
      return;
    }
    pending.forEach((p, cid) => this.transport.emit('card:move', { id: cid, boardId: this.boardId, posX: p.posX, posY: p.posY }));
    pending.clear();
  }
  private scheduleMoveFlush(): void {
    if (this.moveEmit.raf != null) {
      return;
    }
    this.moveEmit.raf = requestAnimationFrame(() => this.flushMoveEmits());
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
  }

  commitDragCard(): void {
    if (this.moveEmit.raf != null) {
      cancelAnimationFrame(this.moveEmit.raf);
      this.moveEmit.raf = null;
    }
    this.flushMoveEmits();

    const starts = this.cardDragStart;
    this.cardDragStart = null;
    if (!starts) {
      return;
    }
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
    this.transport.emit('card:resize', { id, boardId: this.boardId, width: box.width, height: box.height });
    this.transport.emit('card:move', { id, boardId: this.boardId, posX: box.posX, posY: box.posY });
  }

  startResizeCard(id: string): void {
    const card = this.cards().find((c) => c.id === id);
    if (!card) {
      return;
    }
    this.cardResizeStart = { id, posX: card.posX, posY: card.posY, width: card.width, height: card.height };
  }

  commitResizeCard(id: string): void {
    const start = this.cardResizeStart;
    this.cardResizeStart = null;
    if (!start || start.id !== id) {
      return;
    }
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

  updateCard(id: string, content: string): void {
    const oldContent = this.cards().find((c) => c.id === id)?.content ?? '';
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
    const savedCards = ids.map((id) => cards.find((c) => c.id === id)).filter((c): c is Card => !!c);
    const connectionIds = ids.filter((id) => connections.some((c) => c.id === id));
    if (savedCards.length === 0 && connectionIds.length === 0) {
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
        width: conn.width,
      });
    });
  }

  addConnection(fromId: string, toId: string): void {
    this.transport.emit('connection:create', { boardId: this.boardId, fromId, toId });
    this.pendingConnHistory.push((created: Connection) => {
      let trackedId = created.id;
      this.pushHistory({
        undo: () => this.transport.emit('connection:delete', { id: trackedId, boardId: this.boardId }),
        redo: () => {
          this.transport.emit('connection:create', { boardId: this.boardId, fromId, toId });
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
    this.transport.emit('frame:move', { id, boardId: this.boardId, posX, posY });

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
        this.transport.emit('card:move', { id: c.id, boardId: this.boardId, posX: newX, posY: newY });
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
    this.transport.emit('frame:move', { id, boardId: this.boardId, posX, posY });
    this.transport.emit('frame:resize', { id, boardId: this.boardId, width, height });
  }

  startResizeFrame(id: string): void {
    const frame = this.frames().find((f) => f.id === id);
    if (!frame) {
      return;
    }
    this.frameResizeStart = { id, posX: frame.posX, posY: frame.posY, width: frame.width, height: frame.height };
  }

  commitResizeFrame(id: string): void {
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
    this.transport.emit('vote:cast', { sessionId: s.id, boardId: this.boardId, cardId });
  }
  uncastVote(cardId: string): void {
    const s = this.activeVoteSession();
    if (!s) {
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
