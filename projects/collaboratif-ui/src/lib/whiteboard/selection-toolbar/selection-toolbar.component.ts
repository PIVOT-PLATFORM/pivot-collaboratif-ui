import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { BASE_COLORS } from '../model/colors';
import { WbTooltipDirective } from '../tooltip/wb-tooltip.directive';
import type { Connection, ConnectionPatch, ConnCap, ConnLineStyle, ConnShape } from '../model/board.types';

/** Which ends of a connector carry a cap. */
type ArrowDir = 'none' | 'end' | 'start' | 'both';
/** A cap shape — `none` is not one: absence is a direction, not a shape. */
type CapShape = Exclude<ConnCap, 'none'>;

/** none → end → start → both → none. Four states, one button, the icon *is* the state. */
const ARROW_CYCLE: Readonly<Record<ArrowDir, ArrowDir>> = {
  none: 'end',
  end: 'start',
  start: 'both',
  both: 'none',
};

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
  imports: [TranslocoPipe, WbTooltipDirective],
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
  /**
   * Fill of the selected SHAPEs, `null` for no fill — or `undefined` when the selection holds no
   * shape at all, which hides the control. A shape's fill lives in its encoded `content`, not in
   * `card.color`, so the swatch above could never reach it (recette 2026-07-17).
   */
  readonly fillColor = input<string | null | undefined>(undefined);
  /**
   * The single selected connector, or `null`. Present → the toolbar offers its line style and
   * arrows, so an already-drawn link can be restyled from here rather than only from the panel in
   * the far corner (recette 2026-07-17).
   */
  readonly connection = input<Connection | null>(null);
  /** Hides the recolour/duplicate/lock affordances on a read-only board (delete already gated upstream). */
  readonly readOnly = input<boolean>(false);

  readonly duplicate = output<void>();
  /** Emits the picked colour for the whole selection. */
  readonly recolor = output<string>();
  /** Emits the fill picked for the selected SHAPEs — `null` means no fill. */
  readonly refill = output<string | null>();
  /** Emits a partial style patch for the selected connector. */
  readonly connectionStyleChange = output<ConnectionPatch>();
  /** Asks the board to open the selected connector's label editor. */
  readonly editLabel = output<void>();
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
  protected readonly fillOpen = signal(false);
  protected readonly linkOpen = signal(false);
  protected readonly lineStyles: readonly ConnLineStyle[] = ['solid', 'dashed', 'dotted'];
  protected readonly connShapes: readonly ConnShape[] = ['straight', 'curved', 'orthogonal'];
  /** Cap shapes, minus `none` — absence is expressed by the direction cycle, not by a shape. */
  protected readonly caps: readonly CapShape[] = ['arrow', 'triangle', 'circle', 'diamond'];
  /** Remembers the shape so it can be restored after the cycle passes through "no arrow". */
  private readonly lastShape = signal<CapShape>('arrow');

  /** Which ends carry a cap, derived from the two independent fields. */
  protected readonly arrowDir = computed<ArrowDir>(() => {
    const c = this.connection();
    if (!c) {
      return 'none';
    }
    const start = c.startCap !== 'none';
    const end = c.endCap !== 'none';
    return start && end ? 'both' : end ? 'end' : start ? 'start' : 'none';
  });

  /** Shape currently in use — the end's, else the start's, else the last one picked. */
  protected readonly capShape = computed<CapShape>(() => {
    const c = this.connection();
    const inUse = c && c.endCap !== 'none' ? c.endCap : c && c.startCap !== 'none' ? c.startCap : null;
    return (inUse as CapShape) ?? this.lastShape();
  });

  /**
   * One button, four states — the icon *is* the state. Asked for as « une seule fleche, si on
   * reclique sur le btn ca change le sens ».
   */
  protected cycleArrow(): void {
    const next = ARROW_CYCLE[this.arrowDir()];
    const shape = this.capShape();
    this.lastShape.set(shape);
    this.connectionStyleChange.emit({
      startCap: next === 'start' || next === 'both' ? shape : 'none',
      endCap: next === 'end' || next === 'both' ? shape : 'none',
    });
  }

  /** Picking a shape on an arrow-less connector creates the arrow rather than doing nothing. */
  protected chooseCap(cap: CapShape): void {
    this.lastShape.set(cap);
    const dir = this.arrowDir() === 'none' ? 'end' : this.arrowDir();
    this.connectionStyleChange.emit({
      startCap: dir === 'start' || dir === 'both' ? cap : 'none',
      endCap: dir === 'end' || dir === 'both' ? cap : 'none',
    });
  }

  protected chooseShape(shape: ConnShape): void {
    this.connectionStyleChange.emit({ shape });
  }

  /** Whether the selection holds at least one SHAPE — gates the fill swatch. */
  protected readonly hasShape = computed(() => this.fillColor() !== undefined);

  protected chooseFill(fill: string | null): void {
    this.refill.emit(fill);
  }

  protected chooseLineStyle(lineStyle: ConnLineStyle): void {
    this.connectionStyleChange.emit({ lineStyle });
  }

  /** SVG `stroke-dasharray` previewing a line style — `null` for a solid line. */
  protected dashArrayFor(style: ConnLineStyle): string | null {
    if (style === 'dashed') {
      return '6 4';
    }
    return style === 'dotted' ? '2 3' : null;
  }

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
