import { Routes } from '@angular/router';
import { boardAccessGuard } from '../core/whiteboard/board-access.guard';
import { BoardListComponent } from './board-list/board-list.component';

export const whiteboardRoutes: Routes = [
  {
    path: '',
    component: BoardListComponent,
  },
  {
    path: ':boardId',
    canActivate: [boardAccessGuard],
    // TODO(US08.3.1): replace children:[] with BoardCanvasComponent
    children: [],
  },
];
