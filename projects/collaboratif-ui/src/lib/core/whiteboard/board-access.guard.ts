import { inject } from '@angular/core';
import { CanActivateFn, Router, UrlTree } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { TranslocoService } from '@jsverse/transloco';
import { ToastService } from '../toast/toast.service';
import { COLLABORATIF_API_URL } from './config/tokens';

/**
 * Guard d'accès à un board précis : vérifie les droits via l'API avant d'instancier l'UI canvas.
 *
 * 200 → accès accordé.
 * 403 (membre du tenant mais non-membre du board) / 404 (inexistant ou cross-tenant) / erreur réseau
 * → redirection /whiteboard + toast "Vous n'avez pas accès à ce tableau" (fail-closed).
 *
 * Redirect target note (US08.3.2b Gate 1 clarification): originally redirected to `/home`
 * (EN08.2). US08.3.2b's AC5 explicitly specifies `/whiteboard` for this exact denial path —
 * updated to match, since `/whiteboard` is guaranteed to exist within this lazy-loaded
 * module's own route tree (the board list), whereas `/home` is an assumption about a
 * shell-level (`pivot-ui`) route this repo cannot verify.
 */
export const boardAccessGuard: CanActivateFn = (route): Observable<boolean | UrlTree> => {
  const http = inject(HttpClient);
  const router = inject(Router);
  const toast = inject(ToastService);
  const transloco = inject(TranslocoService);
  const apiUrl = inject(COLLABORATIF_API_URL);
  const boardId = route.paramMap.get('boardId');

  const denyAccess = (): Observable<UrlTree> => {
    toast.show(transloco.translate('whiteboard.guard.accessDenied'), 'error');
    return of(router.createUrlTree(['/whiteboard']));
  };

  if (!boardId) {
    return denyAccess();
  }

  return http
    .get<unknown>(`${apiUrl}/whiteboard/boards/${boardId}`)
    .pipe(
      map(() => true),
      catchError(() => denyAccess()),
    );
};
