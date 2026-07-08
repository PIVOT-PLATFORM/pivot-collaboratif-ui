import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { Board, BoardMember, BoardPage, JoinBoardResult, ShareToken } from './board.model';
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

  /** Fetches a paginated page of boards accessible to the current user. */
  getBoards(page = 0): Observable<BoardPage> {
    return this.http.get<BoardPage>(`${this.apiUrl}/whiteboard/boards`, {
      params: { page: String(page), size: String(PAGE_SIZE) },
    });
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

  /** Renames a board (OWNER only). */
  renameBoard(boardId: string, title: string): Observable<Board> {
    return this.http.patch<Board>(
      `${this.apiUrl}/whiteboard/boards/${boardId}`,
      { title },
    );
  }

  /** Permanently deletes a board and all its data (OWNER only). */
  deleteBoard(boardId: string): Observable<void> {
    return this.http.delete<void>(
      `${this.apiUrl}/whiteboard/boards/${boardId}`,
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
