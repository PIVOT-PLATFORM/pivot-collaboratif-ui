import { Routes } from '@angular/router';
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
    //
    // No `canActivate` guard here (deliberately — see BoardStore.loadBoard()): the canvas
    // shell mounts immediately, and the same 403/404 access check that `boardAccessGuard`
    // used to perform *before* mounting is now performed by BoardStore's own REST call
    // *after* mounting, with an identical fail-closed outcome (toast + redirect to
    // `/whiteboard`, US08.3.2b AC5) — it no longer blocks the canvas from rendering while
    // that check is in flight.
    path: ':boardId',
    loadComponent: () => import('./board-page/board-page.component').then(m => m.BoardPageComponent),
  },
];
