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
