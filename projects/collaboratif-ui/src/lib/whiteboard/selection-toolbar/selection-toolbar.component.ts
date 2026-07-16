import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';

/**
 * Floating action bar shown at the bottom-centre of the board while a selection is active
 * (PouetPouet parity). Surfaces the selection count and the batch actions — copy, paste,
 * duplicate, lock/unlock, delete — that also have keyboard shortcuts on the board page.
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
  /** Whether the clipboard holds cards to paste — gates the paste button. */
  readonly canPaste = input<boolean>(false);
  /** True when every selected card is locked — flips the lock toggle to "unlock". */
  readonly allLocked = input<boolean>(false);
  /** Hides the copy/duplicate/lock affordances on a read-only board (delete/paste already gated upstream). */
  readonly readOnly = input<boolean>(false);

  readonly copy = output<void>();
  readonly paste = output<void>();
  readonly duplicate = output<void>();
  /** Emits the desired locked state (true = lock, false = unlock). */
  readonly toggleLock = output<boolean>();
  readonly remove = output<void>();

  protected readonly countLabelKey = computed(() =>
    this.count() > 1 ? 'whiteboard.selection.countPlural' : 'whiteboard.selection.count',
  );
}
