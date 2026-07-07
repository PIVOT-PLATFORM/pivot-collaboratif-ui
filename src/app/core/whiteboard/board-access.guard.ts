import { inject } from '@angular/core';
import { CanActivateFn, Router, UrlTree } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { TranslocoService } from '@jsverse/transloco';
import { ToastService } from '../toast/toast.service';
import { environment } from '../../../environments/environment';

/**
 * Guard d'accès à un board précis : vérifie les droits via l'API avant d'instancier l'UI canvas.
 *
 * 200 → accès accordé.
 * 403 (membre du tenant mais non-membre du board) / 404 (inexistant ou cross-tenant) / erreur réseau
 * → redirection /home + toast "Vous n'avez pas accès à ce tableau" (fail-closed).
 */
export const boardAccessGuard: CanActivateFn = (route): Observable<boolean | UrlTree> => {
  const http = inject(HttpClient);
  const router = inject(Router);
  const toast = inject(ToastService);
  const transloco = inject(TranslocoService);
  const boardId = route.paramMap.get('boardId');

  const denyAccess = (): Observable<UrlTree> => {
    toast.show(transloco.translate('whiteboard.guard.accessDenied'), 'error');
    return of(router.createUrlTree(['/home']));
  };

  if (!boardId) {
    return denyAccess();
  }

  return http
    .get<unknown>(`${environment.apiUrl}/whiteboard/boards/${boardId}`)
    .pipe(
      map(() => true),
      catchError(() => denyAccess()),
    );
};
