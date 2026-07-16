import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
} from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { BoardStore } from '../../core/whiteboard/board.store';
import type { BoardField, Card } from '../model/board.types';
import { formatFieldValue } from '../model/card-format';

/** A board field paired with the selected card's current value for it (`''` when unset). */
interface FieldValueRow {
  field: BoardField;
  value: string;
}

/**
 * Per-card custom-field VALUE editor (US08.10.2).
 *
 * Shown for the single selected card, it lets an OWNER/EDITOR set or clear the value of each
 * board field ({@link BoardStore.fields}) on that card. Each field renders a native, labelled
 * control matched to its {@link BoardField.type} — `TEXT`→text input, `NUMBER`→number input,
 * `DATE`→date input, `SELECT`→a `<select>` of the field's options plus an empty "— none —"
 * choice. Committing a control delegates to the board-scoped store: a non-empty value emits
 * `cardfield:set` via {@link BoardStore.setFieldValue}, an emptied one (or the "none" choice, or
 * the per-field clear button) emits `cardfield:clear` via {@link BoardStore.clearFieldValue}.
 *
 * Purely a view layer — no business logic lives here. Local render state is derived with a
 * single {@link rows} `computed`, so an inbound `cardfield:updated`/`cardfield:cleared`
 * broadcast (which mutates the card in the store) re-projects the shown values with no extra
 * plumbing. VIEWERs ({@link BoardStore.isReadonly}) see the values read-only, with no control.
 * When the board defines no field, the editor renders an empty state instead of blank controls.
 */
@Component({
  selector: 'wb-card-field-values-panel',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslocoPipe],
  templateUrl: './card-field-values-panel.component.html',
  styleUrl: './card-field-values-panel.component.scss',
})
export class CardFieldValuesPanelComponent {
  private readonly store = inject(BoardStore);

  /** The card whose custom-field values are being edited. */
  readonly card = input.required<Card>();

  /** Emitted when the user dismisses the panel from its header close button. */
  readonly close = output<void>();

  /** True when the current user may not edit values (VIEWER role) — controls become read-only. */
  protected readonly readonly = this.store.isReadonly;

  /** `(field, current value)` pairs in schema order; `value` is `''` when the field is unset. */
  protected readonly rows = computed<FieldValueRow[]>(() => {
    const values = this.card().fieldValues;
    return [...this.store.fields()]
      .sort((a, b) => a.order - b.order)
      .map((field) => ({
        field,
        value: values.find((v) => v.fieldId === field.id)?.value ?? '',
      }));
  });

  /** DOM id used to associate a field's `<label>` with its control (WCAG name-from-label). */
  protected controlId(field: BoardField): string {
    return `wb-fv-${field.id}`;
  }

  /** Human-readable rendering of a stored value (localizes DATE) — for the read-only view. */
  protected displayValue(type: BoardField['type'], value: string): string {
    return formatFieldValue(type, value);
  }

  /**
   * Commits an edited control: an empty (or whitespace-only) value clears the field
   * (`cardfield:clear`), otherwise it is set (`cardfield:set`). No-op for read-only viewers.
   */
  protected onValueChange(field: BoardField, event: Event): void {
    if (this.readonly()) {
      return;
    }
    const value = (event.target as HTMLInputElement | HTMLSelectElement).value;
    if (value.trim() === '') {
      this.store.clearFieldValue(this.card().id, field.id);
    } else {
      this.store.setFieldValue(this.card().id, field.id, value);
    }
  }

  /** Clears a single field's value on the card via the store (`cardfield:clear`). */
  protected clearValue(field: BoardField): void {
    if (this.readonly()) {
      return;
    }
    this.store.clearFieldValue(this.card().id, field.id);
  }

  protected onClose(): void {
    this.close.emit();
  }
}
