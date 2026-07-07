import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
} from '@angular/core';
import { DatePipe } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { BoardService } from '../../core/whiteboard/board.service';
import { ToastService } from '../../core/toast/toast.service';
import { Board } from '../../core/whiteboard/board.model';

@Component({
  selector: 'app-board-list',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, TranslocoPipe, DatePipe],
  templateUrl: './board-list.component.html',
  styleUrl: './board-list.component.scss',
})
export class BoardListComponent {
  protected readonly boards = signal<Board[]>([]);
  protected readonly status = signal<'loading' | 'loaded' | 'error'>('loading');
  protected readonly hasNext = signal(false);
  protected readonly currentPage = signal(0);
  protected readonly showCreateModal = signal(false);
  protected readonly isCreating = signal(false);
  protected readonly createTitle = signal('');
  protected readonly activeMenuBoardId = signal<string | null>(null);
  protected readonly skeletons = Array.from<null>({ length: 8 });

  private readonly boardService = inject(BoardService);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  private readonly transloco = inject(TranslocoService);

  constructor() {
    this.loadBoards(0);
  }

  protected loadBoards(page: number): void {
    if (page === 0) {
      this.status.set('loading');
    }
    this.boardService.getBoards(page).subscribe({
      next: (response) => {
        const merged =
          page === 0 ? response.boards : [...this.boards(), ...response.boards];
        this.boards.set(merged);
        this.hasNext.set(response.hasNext);
        this.currentPage.set(response.currentPage);
        this.status.set('loaded');
      },
      error: () => this.status.set('error'),
    });
  }

  protected loadMore(): void {
    this.loadBoards(this.currentPage() + 1);
  }

  protected openCreateModal(): void {
    this.createTitle.set('');
    this.showCreateModal.set(true);
  }

  protected closeCreateModal(): void {
    this.showCreateModal.set(false);
  }

  protected onTitleInput(event: Event): void {
    this.createTitle.set((event.target as HTMLInputElement).value);
  }

  protected submitCreate(): void {
    const title = this.createTitle().trim();
    if (!title || this.isCreating()) return;
    this.isCreating.set(true);
    this.boardService.createBoard(title).subscribe({
      next: (board) => {
        this.isCreating.set(false);
        this.showCreateModal.set(false);
        this.router.navigate(['/whiteboard', board.id]);
      },
      error: () => {
        this.isCreating.set(false);
        this.toast.show(
          this.transloco.translate('whiteboard.board.list.createError'),
          'error',
        );
      },
    });
  }

  protected toggleMenu(boardId: string, event: Event): void {
    event.stopPropagation();
    this.activeMenuBoardId.set(
      this.activeMenuBoardId() === boardId ? null : boardId,
    );
  }

  /** Stub — rename delegated to US08.1.4. */
  protected onRenameStub(_boardId: string): void {}

  /** Stub — delete delegated to US08.1.5. */
  protected onDeleteStub(_boardId: string): void {}

  protected retry(): void {
    this.loadBoards(0);
  }

  protected roleLabel(role: Board['role']): string {
    return this.transloco.translate(`whiteboard.board.list.role.${role}`);
  }

  protected cardAriaLabel(board: Board, formattedDate: string): string {
    return this.transloco.translate('whiteboard.board.list.aria.openBoard', {
      title: board.title,
      date: formattedDate,
      role: this.roleLabel(board.role),
    });
  }
}
