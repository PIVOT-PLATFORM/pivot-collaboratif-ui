import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import type { BoardField, Card } from '../model/board.types';
import {
  parseTextFmt,
  parseLabelFmt,
  serializeTextFmt,
  serializeLabelFmt,
  formatFieldValue,
  TEXT_DEFAULT_COLOR,
} from '../model/card-format';
import { parseShape, type ShapeKind } from '../model/shape';
import { parseTableContent, serializeTable } from '../model/table';
import { headerTint, accessibleTextColorFor } from '../model/colors';
import { linkDisplayLabel, safeLinkHref, safeLinkImage } from '../model/link-preview';

/** i18n key per {@link ShapeKind}, feeding the SHAPE `aria-label` (US08.6.3 A11y AC). */
const SHAPE_KIND_KEYS: Record<ShapeKind, string> = {
  rect: 'whiteboard.card.shape.kind.rect',
  circle: 'whiteboard.card.shape.kind.circle',
  diamond: 'whiteboard.card.shape.kind.diamond',
  triangle: 'whiteboard.card.shape.kind.triangle',
  line: 'whiteboard.card.shape.kind.line',
  star: 'whiteboard.card.shape.kind.star',
};

/** 8 resize-handle directions (canvas delegates pointer events by `data-resize-dir`). */
const RESIZE_DIRS = ['tl', 't', 'tr', 'l', 'r', 'bl', 'b', 'br'] as const;

/**
 * A single board object. Renders one of the seven card types (TEXT, LABEL, SHAPE, DRAW,
 * IMAGE, TABLE, LINK), owns inline text editing, and exposes selection/resize/connect
 * affordances whose pointer interactions are delegated to the parent canvas (which owns
 * the viewport transform and the shared drag/resize state machine — mirroring how
 * PouetPouet's `board-canvas.tsx` centralises pointer handling around `board-card.tsx`).
 *
 * Geometry is projected via host style bindings from the {@link Card} model, so a live
 * drag (which mutates the card signal in {@link import('../../core/whiteboard/board.store').BoardStore})
 * re-positions the element with no extra plumbing.
 */
@Component({
  selector: 'wb-board-card',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslocoPipe],
  templateUrl: './board-card.component.html',
  styleUrl: './board-card.component.scss',
  host: {
    '[style.left.px]': 'card().posX',
    '[style.top.px]': 'card().posY',
    '[style.width.px]': 'card().width',
    '[style.height.px]': 'card().height',
    '[style.zIndex]': 'card().layer',
    '[class.wb-card--selected]': 'selected()',
    '[class.wb-card--locked]': 'card().locked',
    '[attr.data-card-id]': 'card().id',
    // A11y (US08.6.1/US08.6.2): TEXT/LABEL cards are keyboard-focusable — Enter/F2 while
    // focused opens inline edit, mirroring the existing dblclick path.
    '[attr.tabindex]': 'isTextualCard() ? 0 : null',
    '[attr.aria-label]': 'hostAriaLabel()',
    '(keydown)': 'onHostKeydown($event)',
  },
})
export class BoardCardComponent {
  /** The card model to render. */
  readonly card = input.required<Card>();
  /** Board field schema — drives the field-value chips. */
  readonly fields = input<BoardField[]>([]);
  /** Whether this card is part of the current selection. */
  readonly selected = input<boolean>(false);
  /** Display name of a remote user currently editing this card (soft-lock), or null. */
  readonly remoteEditorName = input<string | null>(null);
  /** Read-only mode (VIEWER role or disconnected) — disables all edit affordances. */
  readonly readOnly = input<boolean>(false);
  /** One-shot: open in edit mode on mount (creator of a freshly-created card). */
  readonly autoEdit = input<boolean>(false);

  /** Commits an edited `content` string for this card. */
  readonly contentCommit = output<string>();
  /** Fires when the card enters (true) / leaves (false) inline edit — for soft-lock notify. */
  readonly editingChange = output<boolean>();
  /** Requests the card-detail modal for this card. */
  readonly openDetail = output<string>();

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly transloco = inject(TranslocoService);
  private readonly editArea = viewChild<ElementRef<HTMLTextAreaElement>>('editArea');
  private readonly cellInput = viewChild<ElementRef<HTMLInputElement>>('cellInput');

  protected readonly resizeDirs = RESIZE_DIRS;
  protected readonly editing = signal(false);
  protected readonly editValue = signal('');

  /** Cell currently in inline edit mode for a TABLE card (US08.6.6 a11y: F2/Enter to edit,
   *  arrow keys to navigate, per {@link onCellNavKeydown}), or `null` when none is editing. */
  protected readonly editingCell = signal<{ r: number; c: number } | null>(null);
  protected readonly editCellValue = signal('');

  protected readonly textFmt = computed(() => parseTextFmt(this.card().content));
  protected readonly labelFmt = computed(() => parseLabelFmt(this.card().content));
  protected readonly shape = computed(() => parseShape(this.card().content));
  protected readonly table = computed(() => parseTableContent(this.card().content));
  protected readonly headerColor = computed(() => headerTint(this.card().color));
  /**
   * Ink colour actually rendered for a TEXT card's (non-editing) text. Only the *default*,
   * unstyled ink ({@link TEXT_DEFAULT_COLOR}) is ever adjusted — and only when it would
   * otherwise fail WCAG 2.1 AA contrast against the card's background colour (US08.6.1 A11y
   * AC: ratio ≥ 4.5:1, regardless of which background swatch was picked); a colour a user
   * explicitly chose via rich-text formatting is always left untouched.
   */
  protected readonly displayTextColor = computed(() => {
    const color = this.textFmt().color;
    return color === TEXT_DEFAULT_COLOR ? accessibleTextColorFor(this.card().color, TEXT_DEFAULT_COLOR) : color;
  });

  /**
   * Render-safe `href` for a LINK card — `null` (an inert, non-navigating link) if the card's
   * content is somehow not a well-formed `http`/`https` URL (US08.6.5).
   */
  protected readonly linkHref = computed(() => safeLinkHref(this.card()));
  /** Render-safe OpenGraph preview image URL, or `null` while unset/invalid (US08.6.5). */
  protected readonly linkImage = computed(() => safeLinkImage(this.card().meta));
  /** OG title if present, otherwise the raw URL — the "brut" fallback state (US08.6.5 A11y AC). */
  protected readonly linkLabel = computed(() => linkDisplayLabel(this.card(), this.card().meta));
  /** `alt` text for the preview image: title, then site name, then a generic translated fallback. */
  protected readonly linkImageAlt = computed(() => {
    const meta = this.card().meta;
    return meta?.title?.trim() || meta?.siteName?.trim() || this.transloco.translate('whiteboard.card.link.previewAlt');
  });

  /** TEXT and LABEL are the two inline-editable ("textual") card types. */
  protected readonly isTextualCard = computed(() => {
    const t = this.card().type;
    return t === 'TEXT' || t === 'LABEL';
  });

  /**
   * Explicit `aria-label` for the card host — required by US08.6.2's A11y AC for LABEL
   * ("Étiquette"). Other card types are left to their own AC (returns `null`, no attribute).
   */
  protected readonly hostAriaLabel = computed(() => {
    if (this.card().type === 'LABEL') {
      return this.transloco.translate('whiteboard.card.label.ariaLabel');
    }
    return null;
  });

  /**
   * `aria-label` describing a SHAPE card's nature (e.g. "Forme : rectangle") — US08.6.3 A11y
   * AC. The SHAPE content encoding carries no text of its own (see `model/shape.ts`), so this
   * label is the kind alone; `null` for every other card type (no attribute rendered).
   */
  protected readonly shapeAriaLabel = computed(() => {
    if (this.card().type !== 'SHAPE') {
      return null;
    }
    const kindLabel = this.transloco.translate(SHAPE_KIND_KEYS[this.shape().kind]);
    return this.transloco.translate('whiteboard.card.shape.ariaLabel', { kind: kindLabel });
  });

  /** Field-value chips: (field, formatted value) pairs, in field order. */
  protected readonly chips = computed(() => {
    const values = this.card().fieldValues;
    return this.fields()
      .map((f) => {
        const fv = values.find((v) => v.fieldId === f.id);
        return fv ? { field: f, text: formatFieldValue(f.type, fv.value) } : null;
      })
      .filter((c): c is { field: BoardField; text: string } => c !== null);
  });

  constructor() {
    // Auto-open editing once, for the creator of a new TEXT/LABEL card.
    effect(() => {
      if (this.autoEdit() && !this.readOnly() && this.isTextualCard()) {
        this.startEdit();
      }
    });
  }

  /** Enters inline edit mode for TEXT/LABEL cards. */
  protected startEdit(): void {
    if (this.readOnly() || !this.isTextualCard() || this.editing()) {
      return;
    }
    const t = this.card().type;
    this.editValue.set(t === 'LABEL' ? parseLabelFmt(this.card().content).text : parseTextFmt(this.card().content).text);
    this.editing.set(true);
    this.editingChange.emit(true);
    queueMicrotask(() => this.editArea()?.nativeElement.focus());
  }

  /** Commits the edited text, re-wrapping it in the card's formatting envelope. */
  protected commitEdit(): void {
    if (!this.editing()) {
      return;
    }
    this.editing.set(false);
    this.editingChange.emit(false);
    const t = this.card().type;
    const next =
      t === 'LABEL'
        ? serializeLabelFmt({ ...parseLabelFmt(this.card().content), text: this.editValue() })
        : serializeTextFmt({ ...parseTextFmt(this.card().content), text: this.editValue() });
    if (next !== this.card().content) {
      this.contentCommit.emit(next);
    }
  }

  /** Cancels editing without committing. */
  protected cancelEdit(): void {
    if (!this.editing()) {
      return;
    }
    this.editing.set(false);
    this.editingChange.emit(false);
  }

  protected onEditKeydown(event: KeyboardEvent): void {
    // Stops here — without it, the same keydown would bubble up to the host's own
    // (keydown) listener (onHostKeydown) after commitEdit()/cancelEdit() has already flipped
    // `editing` back to false, immediately reopening edit mode on every Enter/Escape.
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      event.stopPropagation();
      this.commitEdit();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      this.cancelEdit();
    }
  }

  protected onDoubleClick(): void {
    if (this.isTextualCard()) {
      this.startEdit();
    } else {
      this.openDetail.emit(this.card().id);
    }
  }

  /**
   * Opens inline edit on Enter/F2 while the card host itself has keyboard focus (US08.6.1/
   * US08.6.2 A11y AC) — the keyboard-equivalent of {@link onDoubleClick}'s dblclick-to-edit
   * for TEXT/LABEL cards. Ignored when the keydown bubbled up from a descendant (e.g. a
   * resize handle, which has no keydown handling of its own and would otherwise re-trigger
   * this on every Enter/F2 press while focused) rather than originating on the host, and
   * while already editing or read-only.
   */
  protected onHostKeydown(event: KeyboardEvent): void {
    if (event.target !== this.host.nativeElement) {
      return;
    }
    if (this.editing() || this.readOnly() || !this.isTextualCard()) {
      return;
    }
    if (event.key === 'Enter' || event.key === 'F2') {
      event.preventDefault();
      this.startEdit();
    }
  }

  // ── TABLE cell editing + keyboard navigation (US08.6.6, a11y) ────────────────────────────

  /** Whether the given grid coordinates are the cell currently being edited. */
  protected isEditingCell(r: number, c: number): boolean {
    const e = this.editingCell();
    return e !== null && e.r === r && e.c === c;
  }

  /** Double-click on a cell starts editing it — stops propagation so the card body's own
   *  `(dblclick)` (which opens the detail modal for non-textual cards) never fires too. */
  protected onCellDoubleClick(event: MouseEvent, r: number, c: number): void {
    event.stopPropagation();
    this.startCellEdit(r, c);
  }

  /** Enters inline edit mode for a single TABLE cell. */
  protected startCellEdit(r: number, c: number): void {
    if (this.readOnly() || this.card().locked) {
      return;
    }
    const rows = this.table().rows;
    this.editCellValue.set(rows[r]?.[c] ?? '');
    this.editingCell.set({ r, c });
    queueMicrotask(() => this.cellInput()?.nativeElement.focus());
  }

  /** Commits the edited cell value, re-serializing the whole grid (content is the full
   *  table JSON, not a per-cell diff — see `table.ts`). No-op if the grid is unchanged. */
  protected commitCellEdit(): void {
    const cell = this.editingCell();
    if (!cell) {
      return;
    }
    this.editingCell.set(null);
    const { rows, colW } = this.table();
    const nextRows = rows.map((row, ri) =>
      ri === cell.r ? row.map((value, ci) => (ci === cell.c ? this.editCellValue() : value)) : row,
    );
    const nextContent = serializeTable(nextRows, colW);
    if (nextContent !== this.card().content) {
      this.contentCommit.emit(nextContent);
    }
  }

  /** Cancels the in-progress cell edit without committing. */
  protected cancelCellEdit(): void {
    this.editingCell.set(null);
  }

  /** Enter commits, Escape cancels — mirrors {@link onEditKeydown} for TEXT/LABEL. */
  protected onCellEditKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter') {
      event.preventDefault();
      this.commitCellEdit();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      this.cancelCellEdit();
    }
  }

  /** Roving keyboard navigation between TABLE cells: arrow keys move focus, F2/Enter opens
   *  inline edit on the focused cell (WCAG 2.1 AA keyboard-operability AC). */
  protected onCellNavKeydown(event: KeyboardEvent, r: number, c: number): void {
    if (event.key === 'F2' || event.key === 'Enter') {
      event.preventDefault();
      this.startCellEdit(r, c);
      return;
    }
    const deltas: Record<string, [number, number]> = {
      ArrowUp: [-1, 0],
      ArrowDown: [1, 0],
      ArrowLeft: [0, -1],
      ArrowRight: [0, 1],
    };
    const delta = deltas[event.key];
    if (!delta) {
      return;
    }
    event.preventDefault();
    const rows = this.table().rows;
    const nextR = Math.min(rows.length - 1, Math.max(0, r + delta[0]));
    const nextC = Math.min(rows[0].length - 1, Math.max(0, c + delta[1]));
    this.focusCell(nextR, nextC);
  }

  /** Moves DOM focus to the cell at the given grid coordinates (roving tabindex pattern). */
  protected focusCell(r: number, c: number): void {
    this.host.nativeElement
      .querySelector<HTMLElement>(`[data-wb-table-nav][data-row="${r}"][data-col="${c}"]`)
      ?.focus();
  }
>>>>>>> a2b681c (feat(a11y): TABLE card inline cell edit + keyboard navigation (US08.6.6))
}
