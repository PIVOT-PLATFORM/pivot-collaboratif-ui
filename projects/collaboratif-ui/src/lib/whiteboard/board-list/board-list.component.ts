import {
  ChangeDetectionStrategy,
  Component,
  Directive,
  ElementRef,
  computed,
  inject,
  OnDestroy,
  OnInit,
  signal,
} from '@angular/core';
import { DatePipe } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { Subject, debounceTime, distinctUntilChanged } from 'rxjs';
import { BoardService } from '../../core/whiteboard/board.service';
import { ToastService } from '../../core/toast/toast.service';
import { Board } from '../../core/whiteboard/board.model';
import { TemplateGalleryComponent } from '../template-gallery/template-gallery.component';

/** Debounce delay (ms) applied to the search input before re-querying the backend (US08.1.8). */
const SEARCH_DEBOUNCE_MS = 300;

@Directive({ selector: '[boardListAutofocus]', standalone: true })
class BoardListAutofocusDirective implements OnInit {
  private readonly el = inject(ElementRef<HTMLInputElement>);
  ngOnInit(): void {
    this.el.nativeElement.focus();
    this.el.nativeElement.select?.();
  }
}

/** Which listing is currently displayed: the normal board list, or the trash (US08.1.7). */
type ViewMode = 'active' | 'trash';

@Component({
  selector: 'app-board-list',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, TranslocoPipe, DatePipe, BoardListAutofocusDirective, TemplateGalleryComponent],
  templateUrl: './board-list.component.html',
  styleUrl: './board-list.component.scss',
})
export class BoardListComponent implements OnDestroy {
  protected readonly boards = signal<Board[]>([]);
  protected readonly status = signal<'loading' | 'loaded' | 'error'>('loading');
  protected readonly hasNext = signal(false);
  protected readonly currentPage = signal(0);
  protected readonly showCreateModal = signal(false);
  protected readonly isCreating = signal(false);
  protected readonly createTitle = signal('');
  protected readonly createError = signal(false);
  /** Selected template id from the gallery — `null` falls back to a blank ("Vierge") board. */
  protected readonly selectedTemplateId = signal<string | null>(null);
  protected readonly activeMenuBoardId = signal<string | null>(null);
  protected readonly renamingBoardId = signal<string | null>(null);
  protected readonly renameTitle = signal('');
  protected readonly isRenaming = signal(false);
  protected readonly deletingBoard = signal<Board | null>(null);
  protected readonly isDeleting = signal(false);
  protected readonly skeletons = Array.from<null>({ length: 8 });

  /** US08.1.7 — current tab: normal listing or trash. */
  protected readonly viewMode = signal<ViewMode>('active');
  /** US08.1.8 — raw search input value (bound to the field). */
  protected readonly searchTerm = signal('');
  /** US08.1.8 — search term actually applied to the last/next request (post-debounce). */
  protected readonly appliedSearchTerm = signal('');
  /** US08.1.6 — board ids with an in-flight favorite toggle (disables the star to avoid races). */
  protected readonly pendingFavoriteIds = signal<ReadonlySet<string>>(new Set());
  /** US08.1.7 — board id with an in-flight restore request. */
  protected readonly restoringBoardId = signal<string | null>(null);
  /** US08.1.7 — board pending permanent-delete confirmation. */
  protected readonly purgingBoard = signal<Board | null>(null);
  protected readonly isPurging = signal(false);
  /**
   * US08.1.9 — connected-participant counts per board id, fetched once per initial load of the
   * active tab via `GET /whiteboard/boards/presence` (an at-open read, not a live subscription
   * — see `BoardService.getPresence`). A board id absent from this map has zero connected
   * participants.
   */
  protected readonly presenceCounts = signal<ReadonlyMap<string, number>>(new Map());

  private readonly boardService = inject(BoardService);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  private readonly transloco = inject(TranslocoService);
  private readonly search$ = new Subject<string>();

  /**
   * Boards ready for display: favorites first (stable, `updatedAt` DESC within each group), then
   * non-favorites (`updatedAt` DESC) — US08.1.6. Applied client-side, optimistically, on top of
   * whatever page(s) are already loaded; re-derived automatically whenever `boards()` changes.
   */
  protected readonly sortedBoards = computed(() => {
    const list = [...this.boards()];
    return list.sort((a, b) => {
      if (a.favorite !== b.favorite) {
        return a.favorite ? -1 : 1;
      }
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    });
  });

  constructor() {
    this.search$.pipe(debounceTime(SEARCH_DEBOUNCE_MS), distinctUntilChanged()).subscribe((term) => {
      this.appliedSearchTerm.set(term);
      this.loadBoards(0);
    });
    this.loadBoards(0);
  }

  ngOnDestroy(): void {
    this.search$.complete();
  }

  protected loadBoards(page: number): void {
    if (page === 0) {
      this.status.set('loading');
    }
    const query = {
      q: this.appliedSearchTerm().trim() || undefined,
      trashed: this.viewMode() === 'trash',
    };
    this.boardService.getBoards(page, query).subscribe({
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

    // US08.1.9 — refresh presence counts alongside the first page of the active tab. Not
    // fetched for pagination (page > 0, counts already cover every loaded board id) nor for the
    // trash tab (trashed boards have no live presence). A failure here must never break the
    // board list itself — silently keep whatever counts (if any) are already known.
    if (page === 0 && this.viewMode() === 'active') {
      this.boardService.getPresence().subscribe({
        next: (counts) => this.presenceCounts.set(new Map(Object.entries(counts))),
        error: () => undefined,
      });
    }
  }

  protected loadMore(): void {
    this.loadBoards(this.currentPage() + 1);
  }

  /**
   * Resolves the number of participants currently connected to a board (US08.1.9) — sourced
   * from the dedicated presence endpoint when known, falling back to the board's own
   * (currently always-zero, see backend TODO) `activeParticipantCount` otherwise.
   */
  protected participantCount(board: Board): number {
    return this.presenceCounts().get(board.id) ?? board.activeParticipantCount;
  }

  // ── US08.1.8: search ──
  protected onSearchInput(event: Event): void {
    const term = (event.target as HTMLInputElement).value;
    this.searchTerm.set(term);
    this.search$.next(term);
  }

  protected clearSearch(): void {
    this.searchTerm.set('');
    this.search$.next('');
  }

  // ── US08.1.7: trash tab ──
  protected switchView(mode: ViewMode): void {
    if (this.viewMode() === mode) {
      return;
    }
    this.viewMode.set(mode);
    this.activeMenuBoardId.set(null);
    this.loadBoards(0);
  }

  protected startRestore(board: Board): void {
    this.restoringBoardId.set(board.id);
    this.boardService.restoreBoard(board.id).subscribe({
      next: () => {
        this.boards.set(this.boards().filter((b) => b.id !== board.id));
        this.restoringBoardId.set(null);
        this.toast.show('whiteboard.board.trash.restoreSuccess', 'success');
      },
      error: () => {
        this.restoringBoardId.set(null);
        this.toast.show('whiteboard.board.trash.restoreError', 'error');
      },
    });
  }

  protected startPurge(board: Board): void {
    this.activeMenuBoardId.set(null);
    this.purgingBoard.set(board);
  }

  protected cancelPurge(): void {
    this.purgingBoard.set(null);
  }

  protected confirmPurge(): void {
    const board = this.purgingBoard();
    if (!board || this.isPurging()) return;
    this.isPurging.set(true);
    this.boardService.deletePermanent(board.id).subscribe({
      next: () => {
        this.boards.set(this.boards().filter((b) => b.id !== board.id));
        this.purgingBoard.set(null);
        this.isPurging.set(false);
        this.toast.show('whiteboard.board.trash.purgeSuccess', 'success');
      },
      error: () => {
        this.isPurging.set(false);
        this.purgingBoard.set(null);
        this.toast.show('whiteboard.board.trash.purgeError', 'error');
      },
    });
  }

  protected restoreAriaLabel(title: string): string {
    return this.transloco.translate('whiteboard.board.trash.restoreAria', { title });
  }

  protected purgeAriaLabel(title: string): string {
    return this.transloco.translate('whiteboard.board.trash.purgeAria', { title });
  }

  // ── US08.1.6: favorites ──
  protected toggleFavorite(board: Board, event: Event): void {
    event.stopPropagation();
    event.preventDefault();
    if (this.pendingFavoriteIds().has(board.id)) {
      return;
    }
    const nextFavorite = !board.favorite;
    this.pendingFavoriteIds.update((prev) => new Set(prev).add(board.id));
    this.boards.set(this.boards().map((b) => (b.id === board.id ? { ...b, favorite: nextFavorite } : b)));

    const request = nextFavorite
      ? this.boardService.addFavorite(board.id)
      : this.boardService.removeFavorite(board.id);

    request.subscribe({
      next: () => {
        this.pendingFavoriteIds.update((prev) => {
          const next = new Set(prev);
          next.delete(board.id);
          return next;
        });
      },
      error: () => {
        // Roll back — no optimistic update is left unconfirmed on error (AC08.1.6 error case).
        this.boards.set(this.boards().map((b) => (b.id === board.id ? { ...b, favorite: board.favorite } : b)));
        this.pendingFavoriteIds.update((prev) => {
          const next = new Set(prev);
          next.delete(board.id);
          return next;
        });
        this.toast.show('whiteboard.board.favorite.error', 'error');
      },
    });
  }

  protected favoriteAriaLabel(board: Board): string {
    return this.transloco.translate(
      board.favorite ? 'whiteboard.board.favorite.remove' : 'whiteboard.board.favorite.add',
      { title: board.title },
    );
  }

  protected openCreateModal(): void {
    this.createTitle.set('');
    this.createError.set(false);
    this.selectedTemplateId.set(null);
    this.showCreateModal.set(true);
  }

  protected closeCreateModal(): void {
    this.showCreateModal.set(false);
  }

  protected onTitleInput(event: Event): void {
    this.createTitle.set((event.target as HTMLInputElement).value);
  }

  protected onTemplateSelectionChange(templateId: string | null): void {
    this.selectedTemplateId.set(templateId);
  }

  protected submitCreate(): void {
    const title = this.createTitle().trim();
    if (!title || this.isCreating()) return;
    this.isCreating.set(true);
    this.createError.set(false);
    this.boardService.createBoard(title, this.selectedTemplateId() ?? undefined).subscribe({
      next: (board) => {
        this.isCreating.set(false);
        this.showCreateModal.set(false);
        this.router.navigate(['/whiteboard', board.id]);
      },
      error: () => {
        this.isCreating.set(false);
        this.createError.set(true);
        this.toast.show('whiteboard.board.list.createError', 'error');
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
        this.toast.show('whiteboard.board.rename.error', 'error');
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
        this.toast.show('whiteboard.board.delete.success', 'success');
      },
      error: () => {
        this.isDeleting.set(false);
        this.deletingBoard.set(null);
        this.toast.show('whiteboard.board.delete.error', 'error');
      },
    });
  }

  protected retry(): void {
    this.loadBoards(0);
  }

  protected roleLabel(role: Board['role']): string {
    // Board roles arrive upper-cased from the backend (OWNER/EDITOR/VIEWER) while the
    // i18n keys are lower-cased (role.owner/editor/viewer) — normalise before lookup so
    // the label resolves instead of leaking the raw translation key onto the card.
    return this.transloco.translate(`whiteboard.board.list.role.${role.toLowerCase()}`);
  }

  protected cardAriaLabel(board: Board, formattedDate: string): string {
    return this.transloco.translate('whiteboard.board.list.aria.openBoard', {
      title: board.title,
      date: formattedDate,
      role: this.roleLabel(board.role),
    });
  }

  /**
   * Accessible label for the per-board presence indicator (US08.1.9 AC) — "N participant(s)
   * connecté(s)", correct for both the singular and plural count, including zero. Never
   * conveyed by the badge's colour dot alone (see the template).
   */
  protected presenceAriaLabel(board: Board): string {
    return this.transloco.translate('whiteboard.board.presence.aria', {
      count: this.participantCount(board),
    });
  }
}
