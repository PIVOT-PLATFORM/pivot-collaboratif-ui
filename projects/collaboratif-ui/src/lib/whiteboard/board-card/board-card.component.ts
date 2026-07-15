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
import { parseTextFmt, parseLabelFmt, serializeTextFmt, serializeLabelFmt, formatFieldValue } from '../model/card-format';
import { parseShape } from '../model/shape';
import { parseTableContent } from '../model/table';
import { headerTint } from '../model/colors';
import { linkDisplayLabel, safeLinkHref, safeLinkImage } from '../model/link-preview';

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
  private readonly editArea = viewChild<ElementRef<HTMLTextAreaElement>>('editArea');
  private readonly transloco = inject(TranslocoService);

  protected readonly resizeDirs = RESIZE_DIRS;
  protected readonly editing = signal(false);
  protected readonly editValue = signal('');

  protected readonly textFmt = computed(() => parseTextFmt(this.card().content));
  protected readonly labelFmt = computed(() => parseLabelFmt(this.card().content));
  protected readonly shape = computed(() => parseShape(this.card().content));
  protected readonly table = computed(() => parseTableContent(this.card().content));
  protected readonly headerColor = computed(() => headerTint(this.card().color));

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
      if (this.autoEdit() && !this.readOnly() && this.isTextual()) {
        this.startEdit();
      }
    });
  }

  private isTextual(): boolean {
    const t = this.card().type;
    return t === 'TEXT' || t === 'LABEL';
  }

  /** Enters inline edit mode for TEXT/LABEL cards. */
  protected startEdit(): void {
    if (this.readOnly() || !this.isTextual() || this.editing()) {
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
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      this.commitEdit();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      this.cancelEdit();
    }
  }

  protected onDoubleClick(): void {
    if (this.isTextual()) {
      this.startEdit();
    } else {
      this.openDetail.emit(this.card().id);
    }
  }
}
