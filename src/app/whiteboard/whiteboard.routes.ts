import { Routes } from '@angular/router';
import { boardAccessGuard } from '../core/whiteboard/board-access.guard';

/**
 * Routes du module whiteboard — lazy-loaded depuis app.routes.ts sous /whiteboard.
 * La route parente porte le whiteboardModuleGuard (voir app.routes.ts).
 * TODO(US08.1.3): add BoardListComponent to the '' path.
 * TODO(US08.3.1): add BoardCanvasComponent to the ':boardId' path.
 */
export const whiteboardRoutes: Routes = [
  {
    path: '',
    children: [
      {
        path: ':boardId',
        canActivate: [boardAccessGuard],
        children: [],
      },
    ],
  },
];
