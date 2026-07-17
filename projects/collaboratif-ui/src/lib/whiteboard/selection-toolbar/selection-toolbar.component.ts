import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { BASE_COLORS } from '../model/colors';
import { WbTooltipDirective } from '../tooltip/wb-tooltip.directive';
import type { Connection, ConnectionPatch, ConnCap, ConnLineStyle } from '../model/board.types';

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
  protected readonly arrowPresets: readonly { id: string; startCap: ConnCap; endCap: ConnCap }[] = [
    { id: 'none', startCap: 'none', endCap: 'none' },
    { id: 'end', startCap: 'none', endCap: 'arrow' },
    { id: 'both', startCap: 'arrow', endCap: 'arrow' },
  ];

  /** Whether the selection holds at least one SHAPE — gates the fill swatch. */
  protected readonly hasShape = computed(() => this.fillColor() !== undefined);

  protected chooseFill(fill: string | null): void {
    this.refill.emit(fill);
  }

  protected chooseLineStyle(lineStyle: ConnLineStyle): void {
    this.connectionStyleChange.emit({ lineStyle });
  }

  protected chooseArrow(preset: { startCap: ConnCap; endCap: ConnCap }): void {
    this.connectionStyleChange.emit({ startCap: preset.startCap, endCap: preset.endCap });
  }

  protected isArrowPreset(preset: { startCap: ConnCap; endCap: ConnCap }): boolean {
    const c = this.connection();
    return !!c && c.startCap === preset.startCap && c.endCap === preset.endCap;
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
