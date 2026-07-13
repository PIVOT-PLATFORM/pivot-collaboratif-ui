import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  HostListener,
  inject,
  input,
  OnDestroy,
  OnInit,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { BoardService } from '../../core/whiteboard/board.service';
import { ToastService } from '../../core/toast/toast.service';
import type { Board } from '../../core/whiteboard/board.model';

/** Maximum length accepted for the board description (US08.2.4, mirrors the backend constraint). */
export const DESCRIPTION_MAX_LENGTH = 500;

/**
 * Known facilitation-activity codes (same catalogue as {@link import('../activities-panel/activities-panel.component').ActivitiesPanelComponent}).
 * None of them are actually implemented/deliverable yet in the Socle scope (F30.x Backlog) — every
 * toggle therefore renders `disabled` with a "coming soon" hint, per US08.2.4's AC: only activities
 * that are genuinely delivered may ever be toggled on.
 */
const KNOWN_ACTIVITY_CODES: readonly string[] = [
  'brainstorming',
  'poll',
  'dotvote',
  'icebreaker',
  'quiz',
  'timer',
  'retro',
];

/**
 * OWNER-only board settings modal (US08.2.4): edit name/description, view the (currently
 * all-disabled, "coming soon") activity toggles, save the board as a personal template, and
 * trigger a canvas reset.
 *
 * `role="dialog" aria-modal="true"` with a manual focus trap (Tab/Shift+Tab wrap inside the
 * dialog) and focus restored to the triggering element on close (Escape or the close button) —
 * the caller must pass the trigger element via {@link BoardSettingsModalComponent.triggerElement}.
 */
@Component({
  selector: 'wb-board-settings-modal',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslocoPipe],
  templateUrl: './board-settings-modal.component.html',
  styleUrl: './board-settings-modal.component.scss',
})
export class BoardSettingsModalComponent implements OnInit, AfterViewInit, OnDestroy {
  /** The board being administered. */
  readonly board = input.required<Board>();
  /** Element to restore focus to when the modal closes (A11y — the button that opened it). */
  readonly triggerElement = input<HTMLElement | null>(null);

  /** Emitted when the modal is closed (Escape, close button, or successful save). */
  readonly closed = output<void>();
  /** Emitted with the updated board after a successful settings save. */
  readonly saved = output<Board>();
  /** Emitted after a successful canvas reset. */
  readonly resetDone = output<void>();

  private readonly boardService = inject(BoardService);
  private readonly toast = inject(ToastService);
  private readonly host = inject(ElementRef<HTMLElement>);

  protected readonly activityCodes = KNOWN_ACTIVITY_CODES;
  protected readonly descriptionMaxLength = DESCRIPTION_MAX_LENGTH;

  protected readonly name = signal('');
  protected readonly description = signal('');
  protected readonly isSaving = signal(false);
  protected readonly showResetConfirm = signal(false);
  protected readonly isResetting = signal(false);
  protected readonly isSavingTemplate = signal(false);
  protected readonly templateName = signal('');
  protected readonly showTemplatePrompt = signal(false);

  private readonly firstField = viewChild<ElementRef<HTMLInputElement>>('firstField');

  ngOnInit(): void {
    const b = this.board();
    this.name.set(b.title);
    this.description.set(b.description ?? '');
  }

  ngAfterViewInit(): void {
    queueMicrotask(() => this.firstField()?.nativeElement.focus());
  }

  ngOnDestroy(): void {
    this.triggerElement()?.focus();
  }

  protected close(): void {
    this.closed.emit();
  }

  protected onNameInput(event: Event): void {
    this.name.set((event.target as HTMLInputElement).value);
  }

  protected onDescriptionInput(event: Event): void {
    this.description.set((event.target as HTMLTextAreaElement).value.slice(0, DESCRIPTION_MAX_LENGTH));
  }

  protected save(): void {
    const title = this.name().trim();
    if (!title || this.isSaving()) {
      return;
    }
    this.isSaving.set(true);
    this.boardService
      .updateBoardSettings(this.board().id, {
        title,
        description: this.description().trim() || null,
      })
      .subscribe({
        next: (updated) => {
          this.isSaving.set(false);
          this.toast.show('whiteboard.board.settings.saveSuccess', 'success');
          this.saved.emit(updated);
        },
        error: () => {
          this.isSaving.set(false);
          this.toast.show('whiteboard.board.settings.saveError', 'error');
        },
      });
  }

  protected openTemplatePrompt(): void {
    this.templateName.set(this.board().title);
    this.showTemplatePrompt.set(true);
  }

  protected cancelTemplatePrompt(): void {
    this.showTemplatePrompt.set(false);
  }

  protected onTemplateNameInput(event: Event): void {
    this.templateName.set((event.target as HTMLInputElement).value);
  }

  protected confirmSaveAsTemplate(): void {
    const name = this.templateName().trim();
    if (!name || this.isSavingTemplate()) {
      return;
    }
    this.isSavingTemplate.set(true);
    this.boardService.saveAsTemplate(this.board().id, { name }).subscribe({
      next: () => {
        this.isSavingTemplate.set(false);
        this.showTemplatePrompt.set(false);
        this.toast.show('whiteboard.board.settings.saveAsTemplateSuccess', 'success');
      },
      error: () => {
        this.isSavingTemplate.set(false);
        this.toast.show('whiteboard.board.settings.saveAsTemplateError', 'error');
      },
    });
  }

  protected openResetConfirm(): void {
    this.showResetConfirm.set(true);
  }

  protected cancelReset(): void {
    this.showResetConfirm.set(false);
  }

  protected confirmReset(): void {
    if (this.isResetting()) {
      return;
    }
    this.isResetting.set(true);
    this.boardService.resetBoard(this.board().id).subscribe({
      next: () => {
        this.isResetting.set(false);
        this.showResetConfirm.set(false);
        this.toast.show('whiteboard.board.settings.resetSuccess', 'success');
        this.resetDone.emit();
      },
      error: () => {
        this.isResetting.set(false);
        this.showResetConfirm.set(false);
        this.toast.show('whiteboard.board.settings.resetError', 'error');
      },
    });
  }

  /** Manual focus trap: Tab/Shift+Tab wrap within the dialog's focusable elements. */
  @HostListener('keydown', ['$event'])
  protected onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      this.close();
      return;
    }
    if (event.key !== 'Tab') {
      return;
    }
    const root: HTMLElement = this.host.nativeElement;
    const nodeList: NodeListOf<HTMLElement> = root.querySelectorAll(
      'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    const focusable: HTMLElement[] = Array.from(nodeList);
    if (focusable.length === 0) {
      return;
    }
    const first: HTMLElement = focusable[0];
    const last: HTMLElement = focusable[focusable.length - 1];
    const active = document.activeElement as HTMLElement | null;
    if (event.shiftKey && active === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }
}
