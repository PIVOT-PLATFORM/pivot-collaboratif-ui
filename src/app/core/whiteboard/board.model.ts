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
}

/** Paginated response from GET /whiteboard/boards. */
export interface BoardPage {
  boards: Board[];
  totalElements: number;
  totalPages: number;
  currentPage: number;
  hasNext: boolean;
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
  previewUrl: string;
}
