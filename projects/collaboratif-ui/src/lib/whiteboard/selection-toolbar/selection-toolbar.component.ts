import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { BASE_COLORS } from '../model/colors';

/**
 * Floating action bar shown at the bottom-centre of the board while a selection is active
 * (PouetPouet parity). Surfaces the selection count and the batch actions — recolour, duplicate,
 * lock/unlock, delete. Copy/paste stay keyboard-only (Ctrl+C/V) on the board page.
 *
 * Purely presentational: it holds no board state, only emits intent. The container
 * ({@link BoardPageComponent}) wires each output to the {@link BoardStore}.
 */
@Component({
  selector: 'wb-selection-toolbar',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslocoPipe],
  templateUrl: './selection-toolbar.component.html',
  styleUrl: './selection-toolbar.component.scss',
})
export class SelectionToolbarComponent {
  /** Number of currently selected items (cards + connections). */
  readonly count = input.required<number>();
  /** True when every selected card is locked — flips the lock toggle to "unlock". */
  readonly allLocked = input<boolean>(false);
  /** Swatch shown on the colour button — the selection's colour (or the board's active colour). */
  readonly color = input<string>('#A5B4FC');
  /** Hides the recolour/duplicate/lock affordances on a read-only board (delete already gated upstream). */
  readonly readOnly = input<boolean>(false);

  readonly duplicate = output<void>();
  /** Emits the picked colour for the whole selection. */
  readonly recolor = output<string>();
  /** Emits the desired locked state (true = lock, false = unlock). */
  readonly toggleLock = output<boolean>();
  /**
   * US08.9.3 — request to raise the selection above every other item (z-order). Unlike recolour
   * or delete, this intent applies to *all* selected cards, locked ones included: reordering is
   * the one batch mutation not gated by `locked`.
   */
  readonly bringToFront = output<void>();
  /** US08.9.3 — request to drop the selection beneath every other item (z-order). */
  readonly sendToBack = output<void>();
  readonly remove = output<void>();

  protected readonly palette = BASE_COLORS;
  protected readonly paletteOpen = signal(false);

  protected readonly countLabelKey = computed(() =>
    this.count() > 1 ? 'whiteboard.selection.countPlural' : 'whiteboard.selection.count',
  );

  protected togglePalette(): void {
    this.paletteOpen.update((o) => !o);
  }

  protected pickColor(color: string): void {
    this.recolor.emit(color);
    this.paletteOpen.set(false);
  }
}
