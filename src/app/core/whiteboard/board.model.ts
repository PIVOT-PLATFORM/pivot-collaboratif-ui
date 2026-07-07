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
