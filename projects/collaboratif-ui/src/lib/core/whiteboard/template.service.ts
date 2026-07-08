import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { WhiteboardTemplate } from './board.model';
import { COLLABORATIF_API_URL } from './config/tokens';

/**
 * HTTP client for the whiteboard board template catalog (US08.4.1).
 * Templates are global public entities (`tenant_id IS NULL`) — no tenantId sent from
 * Angular, isolation is enforced server-side only.
 */
@Injectable({ providedIn: 'root' })
export class TemplateService {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = inject(COLLABORATIF_API_URL);

  /**
   * Fetches the list of available global board templates. The "Vierge" (blank) template
   * is intentionally not part of this catalog (see US08.1.1 — blank creation).
   */
  getTemplates(): Observable<WhiteboardTemplate[]> {
    return this.http.get<WhiteboardTemplate[]>(`${this.apiUrl}/whiteboard/templates`);
  }
}
