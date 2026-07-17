import type { KlxCard, KlxConnection, KlxField, KlxFrame } from '../../whiteboard/klx-import/converter';

/** A board member as returned by GET /whiteboard/boards/{boardId}/members. */
export interface BoardMember {
  userId: string;
  role: 'OWNER' | 'EDITOR' | 'VIEWER';
  joinedAt: string;
}

/** Share token response from POST /whiteboard/boards/{boardId}/share. */
export interface ShareToken {
  id: string;
  token: string;
  role: 'EDITOR' | 'VIEWER';
  maxUses: number;
  expiresAt: string;
}

/** Response from POST /whiteboard/join?token={token}. */
export interface JoinBoardResult {
  boardId: string;
  title: string;
  role: 'EDITOR' | 'VIEWER';
  redirectUrl: string;
}

/** A single whiteboard board as returned by the API. */
export interface Board {
  id: string;
  title: string;
  role: 'owner' | 'editor' | 'viewer';
  createdAt: string;
  updatedAt: string;
  thumbnailUrl: string | null;
  activeParticipantCount: number;
  /** US08.1.6 -- true if the current user has marked this board as a favorite. */
  favorite: boolean;
  /** US08.2.4 -- optional board description (max 500 chars, OWNER-editable). */
  description: string | null;
  /** US08.2.4 -- optional custom cover image URL. */
  coverImage: string | null;
  /** US08.2.4 -- optional participant cap. */
  maxParticipants: number | null;
  /** US08.2.4 -- codes of facilitation activities enabled on this board. */
  enabledActivities: string[];
  /**
   * US08.1.7 -- soft-delete timestamp. Present (non-null) only when the board is listed via
   * `trashed=true`; absent/null in the normal (non-trashed) listing and in single-board GETs.
   */
  deletedAt: string | null;
  /**
   * US08.1.9 -- number of active shares (members other than the owner) on this board. Optional
   * for backward compatibility with any test fixture built before this field existed; always
   * present on real API responses.
   */
  shareCount?: number;
  /**
   * US08.1.9 -- the board's cards with their field values, populated only by `GET
   * /whiteboard/boards/{boardId}` (`BoardService.getBoard`) -- always an empty array on list
   * responses (`GET /whiteboard/boards`), which deliberately do not fetch cards. Consumers must
   * not use this field to pre-populate the canvas: the canvas continues to source its state
   * exclusively from the WebSocket `board:state` reply on join (parity spec §2.2) -- this field
   * exists only for callers that need a one-shot snapshot of a board's cards without opening a
   * realtime connection.
   */
  cards?: BoardCard[];
}

/**
 * A single card embedded in `Board.cards`, as returned by `GET /whiteboard/boards/{boardId}`
 * (US08.1.9). Deliberately a distinct, minimal shape from the realtime canvas card model
 * (`whiteboard/model/*`) -- this is a read-only snapshot DTO, not a live canvas object.
 */
export interface BoardCard {
  id: string;
  type: string;
  content: string;
  /**
   * Per-card field values (parity spec §2.2 "fieldValues") -- in this backend, the card's
   * opaque metadata cache (e.g. the OpenGraph preview for a LINK card), or `null` until enriched.
   */
  fieldValues: Record<string, unknown> | null;
  posX: number;
  posY: number;
  width: number;
  height: number;
  color: string;
  groupId: string | null;
  groupColor: string | null;
  locked: boolean;
  layer: number;
}

/** Paginated response from GET /whiteboard/boards. */
export interface BoardPage {
  boards: Board[];
  totalElements: number;
  totalPages: number;
  currentPage: number;
  hasNext: boolean;
}

/** Query parameters accepted by `GET /whiteboard/boards` (US08.1.7 / US08.1.8). */
export interface BoardListQuery {
  /** Free-text search on title/description -- case-insensitive, backend-filtered (US08.1.8). */
  q?: string;
  /** When true, lists the trash (boards with `deletedAt` set) instead of the normal listing. */
  trashed?: boolean;
}

/**
 * Partial update accepted by `PATCH /whiteboard/boards/{boardId}` (US08.1.4 title, extended by
 * US08.2.4). Every field is optional -- an omitted field is left unchanged server-side.
 */
export interface BoardSettingsPatch {
  title?: string;
  description?: string | null;
  coverImage?: string | null;
  maxParticipants?: number | null;
  enabledActivities?: string[];
}

/** Body accepted by `POST /whiteboard/boards/{boardId}/save-as-template` (US08.2.4). */
export interface SaveAsTemplateRequest {
  name: string;
  description?: string;
}

/** Response from `POST /whiteboard/boards/{boardId}/save-as-template` (US08.2.4). */
export interface TemplateResponse {
  id: string;
  name: string;
  description: string | null;
}

/**
 * A global, tenant-agnostic board template as returned by GET /whiteboard/templates
 * (US08.4.1). The "Vierge" (blank) template is not part of this list — blank creation
 * is covered by omitting `templateId` on POST /whiteboard/boards (US08.1.1).
 *
 * `code` is a stable machine key used to resolve the localized name/description via
 * `whiteboard.template.{code}.*` i18n keys — names and descriptions are never sent
 * pre-localized by the backend.
 */
export interface WhiteboardTemplate {
  id: string;
  code: 'BRAINSTORM' | 'RETROSPECTIVE' | 'USER_STORY_MAP';
  thumbnailUrl: string;
}

/**
 * Body accepted by `POST /whiteboard/boards/{boardId}/import/klaxoon` (US08.13.1) — the
 * client-side-converted Klaxoon content (see `whiteboard/klx-import/converter.ts`), minus the
 * preview-only `stats`. `frames`/`fields` are omitted entirely (not sent as empty arrays) when
 * the conversion produced none.
 */
export interface KlaxoonImportRequest {
  cards: KlxCard[];
  connections: KlxConnection[];
  frames?: KlxFrame[];
  fields?: KlxField[];
}

/**
 * Response from `POST /whiteboard/boards/{boardId}/import/klaxoon` — created-object counts plus
 * the three id lists the client must memorize verbatim to drive `undoImport` (US08.13.1 AC: "ce
 * sont ces listes qui font foi pour l'annulation").
 */
export interface KlaxoonImportResponse {
  cards: number;
  connections: number;
  frames: number;
  cardIds: string[];
  connectionIds: string[];
  frameIds: string[];
}

/** Body accepted by `POST /whiteboard/boards/{boardId}/import/undo` (US08.13.1) — the exact
 *  three id lists returned by the preceding import. */
export interface KlaxoonUndoRequest {
  cardIds: string[];
  connectionIds: string[];
  frameIds: string[];
}

/** Response from `POST /whiteboard/boards/{boardId}/import/undo` — counts actually deleted. */
export interface KlaxoonUndoResponse {
  cards: number;
  connections: number;
  frames: number;
}
