import { Routes } from '@angular/router';
import { whiteboardModuleGuard } from './core/whiteboard/whiteboard-module.guard';

export const routes: Routes = [
  {
    path: 'whiteboard',
    canActivate: [whiteboardModuleGuard],
    loadChildren: () =>
      import('./whiteboard/whiteboard.routes').then(m => m.whiteboardRoutes),
  },
];
