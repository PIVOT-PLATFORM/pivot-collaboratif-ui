import { CanActivateFn } from '@angular/router';
import { Observable, of } from 'rxjs';

/**
 * Guard d'activation du module whiteboard.
 *
 * TODO(EN17.3): replace this stub with `moduleGuard('whiteboard')` from `@pivot-platform/ui-core`
 * once published. The real guard will call the module-status API and redirect to /home with a
 * "Module non disponible" toast when the tenant has whiteboard disabled.
 */
export const whiteboardModuleGuard: CanActivateFn = (): Observable<boolean> => of(true);
