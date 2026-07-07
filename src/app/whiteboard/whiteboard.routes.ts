import { Routes } from '@angular/router';
import { boardAccessGuard } from '../core/whiteboard/board-access.guard';
import { BoardListComponent } from './board-list/board-list.component';

export const whiteboardRoutes: Routes = [
  {
    path: '',
    component: BoardListComponent,
  },
  {
    path: 'join',
    loadComponent: () =>
      import('./join-board/join-board.component').then(m => m.JoinBoardComponent),
  },
  {
    path: ':boardId',
    canActivate: [boardAccessGuard],
    loadComponent: () =>
      import('./canvas/whiteboard-canvas.component').then(m => m.WhiteboardCanvasComponent),
  },
];
