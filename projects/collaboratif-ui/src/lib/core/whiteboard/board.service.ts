import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import {
  Board,
  BoardListQuery,
  BoardMember,
  BoardPage,
  BoardSettingsPatch,
  JoinBoardResult,
  SaveAsTemplateRequest,
  ShareToken,
  TemplateResponse,
} from './board.model';
import { COLLABORATIF_API_URL } from './config/tokens';

/** Fixed page size — aligned with backend default. */
const PAGE_SIZE = 20;

/**
 * HTTP client for the whiteboard board resource.
 * Tenant isolation is handled server-side — no tenantId sent from Angular.
 */
@Injectable({ providedIn: 'root' })
export class BoardService {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = inject(COLLABORATIF_API_URL);

  /**
   * Fetches a paginated page of boards accessible to the current user.
   *
   * `query.q` (US08.1.8) filters by title/description, case-insensitive, entirely server-side.
   * `query.trashed` (US08.1.7) switches to the trash listing (boards the user OWNs with
   * `deletedAt` set) instead of the normal listing. Both are optional and combinable.
   */
  getBoards(page = 0, query: BoardListQuery = {}): Observable<BoardPage> {
    const params: Record<string, string> = { page: String(page), size: String(PAGE_SIZE) };
    if (query.q) {
      params['q'] = query.q;
    }
    if (query.trashed) {
      params['trashed'] = 'true';
    }
    return this.http.get<BoardPage>(`${this.apiUrl}/whiteboard/boards`, { params });
  }

  /**
   * Fetches a single board by id — used by `WhiteboardBoardComponent` to source the real
   * board title for the canvas `aria-label` (#41 a11y fix; `boardAccessGuard` already calls
   * the same endpoint but only checks the status code, it never exposes the response body).
   */
  getBoard(boardId: string): Observable<Board> {
    return this.http.get<Board>(`${this.apiUrl}/whiteboard/boards/${boardId}`);
  }

  /**
   * Creates a new board and returns the created board.
   *
   * When `templateId` is provided (US08.4.1), the backend initializes the board's
   * canvas from that global template's content. When omitted, the board is created
   * blank ("Vierge", US08.1.1).
   */
  createBoard(title: string, templateId?: string): Observable<Board> {
    return this.http.post<Board>(
      `${this.apiUrl}/whiteboard/boards`,
      { title },
      templateId ? { params: { templateId } } : {},
    );
  }

  /** Renames a board (OWNER only). Prefer {@link updateBoardSettings} for multi-field edits. */
  renameBoard(boardId: string, title: string): Observable<Board> {
    return this.http.patch<Board>(
      `${this.apiUrl}/whiteboard/boards/${boardId}`,
      { title },
    );
  }

  /**
   * Updates board settings (US08.2.4) -- name, description, cover image, participant cap,
   * enabled activities. Every field is optional; an omitted field is left unchanged server-side.
   * OWNER only for description/coverImage/maxParticipants/enabledActivities.
   */
  updateBoardSettings(boardId: string, patch: BoardSettingsPatch): Observable<Board> {
    return this.http.patch<Board>(
      `${this.apiUrl}/whiteboard/boards/${boardId}`,
      patch,
    );
  }

  /**
   * Soft-deletes a board (US08.1.7): sets `deletedAt`, removes it from normal listings, keeps it
   * restorable from the trash. OWNER only. No data is destroyed by this call.
   */
  deleteBoard(boardId: string): Observable<void> {
    return this.http.delete<void>(
      `${this.apiUrl}/whiteboard/boards/${boardId}`,
    );
  }

  /** Restores a soft-deleted board (US08.1.7): clears `deletedAt`. OWNER only. 409 if not trashed. */
  restoreBoard(boardId: string): Observable<void> {
    return this.http.post<void>(
      `${this.apiUrl}/whiteboard/boards/${boardId}/restore`,
      null,
    );
  }

  /**
   * Permanently deletes a trashed board and all its data (US08.1.7). OWNER only.
   * 409 if the board is not currently in the trash -- purge is only allowed from there.
   */
  deletePermanent(boardId: string): Observable<void> {
    return this.http.delete<void>(
      `${this.apiUrl}/whiteboard/boards/${boardId}/permanent`,
    );
  }

  /**
   * Marks a board as favorite for the current user (US08.1.6). Idempotent upsert -- any member
   * (OWNER/EDITOR/VIEWER) may call it. 404 if the board is inaccessible.
   */
  addFavorite(boardId: string): Observable<void> {
    return this.http.put<void>(
      `${this.apiUrl}/whiteboard/boards/${boardId}/favorite`,
      null,
    );
  }

  /** Removes a board from the current user's favorites (US08.1.6). Idempotent. */
  removeFavorite(boardId: string): Observable<void> {
    return this.http.delete<void>(
      `${this.apiUrl}/whiteboard/boards/${boardId}/favorite`,
    );
  }

  /**
   * Saves the board's current canvas content as a new personal template (US08.2.4).
   * OWNER only.
   */
  saveAsTemplate(boardId: string, request: SaveAsTemplateRequest): Observable<TemplateResponse> {
    return this.http.post<TemplateResponse>(
      `${this.apiUrl}/whiteboard/boards/${boardId}/save-as-template`,
      request,
    );
  }

  /**
   * Clears the board's canvas content (US08.2.4) -- deletes all DRAW canvas events and broadcasts
   * a `RESET` STOMP event to connected participants. Board metadata (title, members, favorites)
   * is untouched. OWNER or EDITOR.
   */
  resetBoard(boardId: string): Observable<void> {
    return this.http.post<void>(
      `${this.apiUrl}/whiteboard/boards/${boardId}/reset`,
      null,
    );
  }

  /** Lists all members of a board (OWNER, EDITOR, VIEWER may call). */
  listMembers(boardId: string): Observable<BoardMember[]> {
    return this.http.get<BoardMember[]>(
      `${this.apiUrl}/whiteboard/boards/${boardId}/members`,
    );
  }

  /** Generates a share invitation token (OWNER only). */
  generateShareToken(boardId: string, role: 'EDITOR' | 'VIEWER'): Observable<ShareToken> {
    return this.http.post<ShareToken>(
      `${this.apiUrl}/whiteboard/boards/${boardId}/share`,
      { role },
    );
  }

  /** Revokes a share token (OWNER only). */
  revokeShareToken(boardId: string, tokenId: string): Observable<void> {
    return this.http.delete<void>(
      `${this.apiUrl}/whiteboard/boards/${boardId}/share/${tokenId}`,
    );
  }

  /** Joins a board using an invitation token; returns board info and redirect URL. */
  joinBoard(token: string): Observable<JoinBoardResult> {
    return this.http.post<JoinBoardResult>(
      `${this.apiUrl}/whiteboard/join`,
      null,
      { params: { token } },
    );
  }

  /** Updates a member's role (OWNER only — EDITOR or VIEWER). */
  updateMemberRole(boardId: string, userId: string, role: 'EDITOR' | 'VIEWER'): Observable<BoardMember> {
    return this.http.patch<BoardMember>(
      `${this.apiUrl}/whiteboard/boards/${boardId}/members/${userId}/role`,
      { role },
    );
  }

  /** Removes a member from a board (OWNER only). */
  removeMember(boardId: string, userId: string): Observable<void> {
    return this.http.delete<void>(
      `${this.apiUrl}/whiteboard/boards/${boardId}/members/${userId}`,
    );
  }
}
