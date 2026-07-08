import { Routes } from '@angular/router';
import { whiteboardModuleGuard } from './core/whiteboard/whiteboard-module.guard';

/**
 * Standalone dev harness only (nginx port 8090) — imports the whiteboard routes directly from
 * the `collaboratif-ui` library project's source (single source of truth, see EN17.9). The real
 * shell (`pivot-ui`) consumes the published `@pivot-platform/collaboratif-ui` package instead.
 */
export const routes: Routes = [
  {
    path: 'whiteboard',
    canActivate: [whiteboardModuleGuard],
    loadChildren: () =>
      import('../../projects/collaboratif-ui/src/lib/whiteboard/whiteboard.routes').then(
        m => m.whiteboardRoutes,
      ),
  },
];
