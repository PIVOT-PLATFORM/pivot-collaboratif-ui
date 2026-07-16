import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  output,
  signal,
} from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { BoardStore } from '../../core/whiteboard/board.store';
import type { BoardField, BoardFieldType } from '../model/board.types';

/** The four custom-field kinds a board can define (mirrors {@link BoardFieldType}). */
const FIELD_TYPES: readonly BoardFieldType[] = ['TEXT', 'NUMBER', 'DATE', 'SELECT'];

/**
 * Board-fields definition panel (US08.10.1).
 *
 * Side panel letting an OWNER/EDITOR manage the board's custom-field schema: list the
 * existing {@link BoardField}s, create a new one (name, optional emoji, type and — for
 * `SELECT` — an option list), edit an existing one (its type is immutable — changing the
 * type requires delete + recreate) and delete one behind a two-step inline confirmation
 * (deleting a field cascades away every card value bound to it).
 *
 * Purely a view layer: all mutation is delegated to the board-scoped {@link BoardStore}
 * (`createField` / `updateField` / `deleteField`), which broadcasts the corresponding
 * `boardfield:*` realtime action. Local editing state (draft form, edit target, pending
 * delete) is held in signals; the options editor is gated by a `computed` on the chosen
 * type. Read-only viewers see the list but no mutating control.
 */
@Component({
  selector: 'wb-board-fields-panel',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslocoPipe],
  templateUrl: './board-fields-panel.component.html',
  styleUrl: './board-fields-panel.component.scss',
})
export class BoardFieldsPanelComponent {
  private readonly store = inject(BoardStore);

  /** Emits when the user dismisses the panel from its header close button. */
  readonly close = output<void>();

  /** The four selectable field types, in schema order. */
  protected readonly fieldTypes = FIELD_TYPES;

  /** True when the current user may not mutate the schema (VIEWER role). */
  protected readonly readonly = this.store.isReadonly;

  /** Board fields, sorted by their persisted `order` for a stable display. */
  protected readonly fields = computed<BoardField[]>(() =>
    [...this.store.fields()].sort((a, b) => a.order - b.order),
  );

  /** Id of the field being edited, or `null` in create mode. */
  protected readonly editingId = signal<string | null>(null);
  /** Draft field name. */
  protected readonly name = signal('');
  /** Draft emoji (optional). */
  protected readonly emoji = signal('');
  /** Draft type — immutable once a field is being edited. */
  protected readonly type = signal<BoardFieldType>('TEXT');
  /** Draft `SELECT` options. */
  protected readonly options = signal<string[]>([]);
  /** Buffer for the next option to append. */
  protected readonly newOption = signal('');
  /** Id of the field awaiting a delete confirmation (second click), or `null`. */
  protected readonly confirmDeleteId = signal<string | null>(null);

  /** True while an existing field is being edited (vs. creating a new one). */
  protected readonly isEditing = computed(() => this.editingId() !== null);
  /** True when the chosen type is `SELECT` — gates the options editor. */
  protected readonly isSelect = computed(() => this.type() === 'SELECT');
  /** True when the draft is valid enough to submit (name present; ≥1 option for `SELECT`). */
  protected readonly canSubmit = computed(
    () => this.name().trim().length > 0 && (!this.isSelect() || this.options().length > 0),
  );

  /** i18n key for a type's human label (e.g. `SELECT` → `whiteboard.field.type.select`). */
  protected typeLabelKey(type: BoardFieldType): string {
    return `whiteboard.field.type.${type.toLowerCase()}`;
  }

  protected onNameInput(event: Event): void {
    this.name.set((event.target as HTMLInputElement).value);
  }

  protected onEmojiInput(event: Event): void {
    this.emoji.set((event.target as HTMLInputElement).value);
  }

  protected onTypeChange(event: Event): void {
    this.type.set((event.target as HTMLSelectElement).value as BoardFieldType);
  }

  protected onNewOptionInput(event: Event): void {
    this.newOption.set((event.target as HTMLInputElement).value);
  }

  /** Appends the buffered option if non-empty and not a duplicate, then clears the buffer. */
  protected addOption(): void {
    const value = this.newOption().trim();
    if (value === '' || this.options().includes(value)) {
      return;
    }
    this.options.update((prev) => [...prev, value]);
    this.newOption.set('');
  }

  /** Removes the option at `index` from the draft. */
  protected removeOption(index: number): void {
    this.options.update((prev) => prev.filter((_, i) => i !== index));
  }

  /** Loads an existing field into the form for editing (its type stays immutable). */
  protected startEdit(field: BoardField): void {
    this.editingId.set(field.id);
    this.name.set(field.name);
    this.emoji.set(field.emoji ?? '');
    this.type.set(field.type);
    this.options.set(field.options ? [...field.options] : []);
    this.newOption.set('');
    this.confirmDeleteId.set(null);
  }

  /** Resets the form back to a blank create state. */
  protected resetForm(): void {
    this.editingId.set(null);
    this.name.set('');
    this.emoji.set('');
    this.type.set('TEXT');
    this.options.set([]);
    this.newOption.set('');
  }

  /** Cancels an in-progress edit, returning the form to create mode. */
  protected cancelEdit(): void {
    this.resetForm();
  }

  /**
   * Persists the draft via the store — `updateField` when editing, `createField` otherwise —
   * then resets the form. Emoji and `SELECT` options are passed only when meaningful.
   */
  protected submit(): void {
    if (this.readonly() || !this.canSubmit()) {
      return;
    }
    const name = this.name().trim();
    const emoji = this.emoji().trim() || undefined;
    const options = this.isSelect() ? this.options() : undefined;
    const editingId = this.editingId();
    if (editingId !== null) {
      this.store.updateField(editingId, name, options, emoji);
    } else {
      this.store.createField(name, this.type(), options, emoji);
    }
    this.resetForm();
  }

  /** Arms the inline delete confirmation for a field (first click). */
  protected requestDelete(id: string): void {
    this.confirmDeleteId.set(id);
  }

  /** Dismisses the pending delete confirmation without deleting. */
  protected cancelDelete(): void {
    this.confirmDeleteId.set(null);
  }

  /** Confirms deletion (second click): delegates to the store and clears related draft state. */
  protected confirmDelete(id: string): void {
    this.store.deleteField(id);
    this.confirmDeleteId.set(null);
    if (this.editingId() === id) {
      this.resetForm();
    }
  }

  protected onClose(): void {
    this.close.emit();
  }
}
