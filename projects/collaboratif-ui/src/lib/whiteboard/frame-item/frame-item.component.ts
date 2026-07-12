import { ChangeDetectionStrategy, Component, ElementRef, input, output, signal, viewChild } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import type { Frame } from '../model/board.types';

/** Resize-handle directions the canvas delegates by `data-frame-resize-dir`. */
const FRAME_RESIZE_DIRS = ['tl', 't', 'tr', 'l', 'r', 'bl', 'b', 'br'] as const;

/**
 * A frame / section box. Ported from the PouetPouet reference (`frame-item.tsx`).
 *
 * Geometry is projected via host bindings from the {@link Frame} model. Move/resize
 * pointer interactions are delegated to the parent canvas (which owns the shared drag
 * state and, for **active** frames, carries the contained unlocked cards — see
 * {@link import('../../core/whiteboard/board.store').BoardStore.moveFrame}). This component
 * owns only inline title editing and the active-toggle affordance.
 */
@Component({
  selector: 'wb-frame-item',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslocoPipe],
  templateUrl: './frame-item.component.html',
  styleUrl: './frame-item.component.scss',
  host: {
    '[style.left.px]': 'frame().posX',
    '[style.top.px]': 'frame().posY',
    '[style.width.px]': 'frame().width',
    '[style.height.px]': 'frame().height',
    '[style.zIndex]': 'frame().layer',
    '[class.wb-frame--selected]': 'selected()',
    '[class.wb-frame--active]': 'frame().active',
    '[attr.data-frame-id]': 'frame().id',
  },
})
export class FrameItemComponent {
  /** Frame model to render. */
  readonly frame = input.required<Frame>();
  /** Whether this frame is currently selected. */
  readonly selected = input<boolean>(false);
  /** Read-only board — disables edit affordances. */
  readonly readOnly = input<boolean>(false);

  /** Commits an edited frame title. */
  readonly titleCommit = output<string>();
  /** Toggles whether the frame carries its contained cards on drag. */
  readonly toggleActive = output<boolean>();

  private readonly titleInput = viewChild<ElementRef<HTMLInputElement>>('titleInput');

  protected readonly resizeDirs = FRAME_RESIZE_DIRS;
  protected readonly editing = signal(false);
  protected readonly draft = signal('');

  protected startEdit(): void {
    if (this.readOnly()) {
      return;
    }
    this.draft.set(this.frame().title);
    this.editing.set(true);
    queueMicrotask(() => this.titleInput()?.nativeElement.focus());
  }

  protected commit(): void {
    if (!this.editing()) {
      return;
    }
    this.editing.set(false);
    const next = this.draft().trim();
    if (next && next !== this.frame().title) {
      this.titleCommit.emit(next);
    }
  }

  protected onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter') {
      event.preventDefault();
      this.commit();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      this.editing.set(false);
    }
  }
}
