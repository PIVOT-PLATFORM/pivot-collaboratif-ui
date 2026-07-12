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
    // Structured board (PouetPouet-aligned port). Supersedes the former freeform
    // `WhiteboardBoardComponent` canvas, which is kept temporarily but no longer routed.
    path: ':boardId',
    canActivate: [boardAccessGuard],
    loadComponent: () => import('./board-page/board-page.component').then(m => m.BoardPageComponent),
  },
];
