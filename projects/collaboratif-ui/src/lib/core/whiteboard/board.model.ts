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
