import {
  ChangeDetectionStrategy,
  Component,
  Directive,
  ElementRef,
  inject,
  OnInit,
  signal,
} from '@angular/core';
import { DatePipe } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { BoardService } from '../../core/whiteboard/board.service';
import { ToastService } from '../../core/toast/toast.service';
import { Board } from '../../core/whiteboard/board.model';

@Directive({ selector: '[boardListAutofocus]', standalone: true })
class BoardListAutofocusDirective implements OnInit {
  private readonly el = inject(ElementRef<HTMLInputElement>);
  ngOnInit(): void {
    this.el.nativeElement.focus();
    this.el.nativeElement.select?.();
  }
}

@Component({
  selector: 'app-board-list',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, TranslocoPipe, DatePipe, BoardListAutofocusDirective],
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
  protected readonly renamingBoardId = signal<string | null>(null);
  protected readonly renameTitle = signal('');
  protected readonly isRenaming = signal(false);
  protected readonly deletingBoard = signal<Board | null>(null);
  protected readonly isDeleting = signal(false);
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

  protected startRename(boardId: string, currentTitle: string): void {
    this.activeMenuBoardId.set(null);
    this.renameTitle.set(currentTitle);
    this.renamingBoardId.set(boardId);
  }

  protected cancelRename(): void {
    this.renamingBoardId.set(null);
  }

  protected onRenameInput(event: Event): void {
    this.renameTitle.set((event.target as HTMLInputElement).value);
  }

  protected confirmRename(boardId: string): void {
    const title = this.renameTitle().trim();
    if (!title || this.isRenaming()) return;
    this.isRenaming.set(true);
    this.boardService.renameBoard(boardId, title).subscribe({
      next: (updated) => {
        this.boards.set(this.boards().map(b => (b.id === boardId ? updated : b)));
        this.renamingBoardId.set(null);
        this.isRenaming.set(false);
      },
      error: () => {
        this.isRenaming.set(false);
        this.renamingBoardId.set(null);
        this.toast.show(
          this.transloco.translate('whiteboard.board.rename.error'),
          'error',
        );
      },
    });
  }

  protected renameAriaLabel(currentTitle: string): string {
    return this.transloco.translate('whiteboard.board.rename.aria', {
      title: currentTitle,
    });
  }

  protected startDelete(board: Board): void {
    this.activeMenuBoardId.set(null);
    this.deletingBoard.set(board);
  }

  protected cancelDelete(): void {
    this.deletingBoard.set(null);
  }

  protected confirmDelete(): void {
    const board = this.deletingBoard();
    if (!board || this.isDeleting()) return;
    this.isDeleting.set(true);
    this.boardService.deleteBoard(board.id).subscribe({
      next: () => {
        this.boards.set(this.boards().filter(b => b.id !== board.id));
        this.deletingBoard.set(null);
        this.isDeleting.set(false);
        this.toast.show(
          this.transloco.translate('whiteboard.board.delete.success'),
          'success',
        );
      },
      error: () => {
        this.isDeleting.set(false);
        this.deletingBoard.set(null);
        this.toast.show(
          this.transloco.translate('whiteboard.board.delete.error'),
          'error',
        );
      },
    });
  }

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
