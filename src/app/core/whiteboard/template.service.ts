import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { WhiteboardTemplate } from './board.model';
import { environment } from '../../../environments/environment';

/**
 * HTTP client for the whiteboard board template catalog (US08.4.1).
 * Templates are global public entities (`tenant_id IS NULL`) — no tenantId sent from
 * Angular, isolation is enforced server-side only.
 */
@Injectable({ providedIn: 'root' })
export class TemplateService {
  private readonly http = inject(HttpClient);

  /**
   * Fetches the list of available global board templates. The "Vierge" (blank) template
   * is intentionally not part of this catalog (see US08.1.1 — blank creation).
   */
  getTemplates(): Observable<WhiteboardTemplate[]> {
    return this.http.get<WhiteboardTemplate[]>(`${environment.apiUrl}/whiteboard/templates`);
  }
}
