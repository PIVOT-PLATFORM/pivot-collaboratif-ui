import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { Board, BoardPage } from './board.model';
import { environment } from '../../../environments/environment';

/** Fixed page size — aligned with backend default. */
const PAGE_SIZE = 20;

/**
 * HTTP client for the whiteboard board resource.
 * Tenant isolation is handled server-side — no tenantId sent from Angular.
 */
@Injectable({ providedIn: 'root' })
export class BoardService {
  private readonly http = inject(HttpClient);

  /** Fetches a paginated page of boards accessible to the current user. */
  getBoards(page = 0): Observable<BoardPage> {
    return this.http.get<BoardPage>(`${environment.apiUrl}/whiteboard/boards`, {
      params: { page: String(page), size: String(PAGE_SIZE) },
    });
  }

  /** Creates a new board and returns the created board. */
  createBoard(title: string): Observable<Board> {
    return this.http.post<Board>(`${environment.apiUrl}/whiteboard/boards`, { title });
  }

  /** Renames a board (OWNER only). */
  renameBoard(boardId: string, title: string): Observable<Board> {
    return this.http.patch<Board>(
      `${environment.apiUrl}/whiteboard/boards/${boardId}`,
      { title },
    );
  }
}
