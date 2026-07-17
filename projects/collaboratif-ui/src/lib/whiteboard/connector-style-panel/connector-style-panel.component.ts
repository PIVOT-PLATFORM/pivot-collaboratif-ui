import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import type { Connection, ConnectionPatch, ConnCap, ConnLineStyle, ConnShape } from '../model/board.types';

/** Values offered by the shape `<select>` (US08.7.2) — a plain string contract, not a backend enum. */
const SHAPES: readonly ConnShape[] = ['straight', 'curved', 'orthogonal'];
/** Values offered by the line-style `<select>` (US08.7.2 extended — supersedes the dashed checkbox). */
const LINE_STYLES: readonly ConnLineStyle[] = ['solid', 'dashed', 'dotted'];
/** Values offered by the start/end cap `<select>`s (US08.7.2 extended — supersedes the arrow select). */
const CAPS: readonly ConnCap[] = ['none', 'arrow', 'triangle', 'circle', 'diamond'];

/**
 * Style panel for an existing, selected connector (US08.7.2 — parity POC PouetPouet §1.8/§3.6).
 * Shown by the board container when exactly one connection is selected (see
 * `BoardPageComponent.selectedConnection`). Purely presentational: every control change emits a
 * **partial** {@link ConnectionPatch} — only the one field the user just touched — through
 * {@link styleChange}; the host delegates the actual mutation to `BoardStore.updateConnection`,
 * which itself only transmits the fields present on the patch (US08.7.2 AC1/AC2).
 *
 * A11y (WCAG 2.1 AA): every control is a native `<select>`/`<input>` with an explicit
 * `<label for>` — no custom widget, fully Tab/keyboard operable.
 */
@Component({
  selector: 'wb-connector-style-panel',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslocoPipe],
  templateUrl: './connector-style-panel.component.html',
  styleUrl: './connector-style-panel.component.scss',
})
export class ConnectorStylePanelComponent {
  /** The connection currently being styled. */
  readonly connection = input.required<Connection>();

  /** Emits a partial patch — one field per change — for the host to apply via `BoardStore.updateConnection`. */
  readonly styleChange = output<ConnectionPatch>();

  protected readonly shapes = SHAPES;
  protected readonly lineStyles = LINE_STYLES;
  protected readonly caps = CAPS;

  protected onShapeChange(event: Event): void {
    const value = (event.target as HTMLSelectElement).value as ConnShape;
    this.styleChange.emit({ shape: value });
  }

  protected onLineStyleChange(event: Event): void {
    const value = (event.target as HTMLSelectElement).value as ConnLineStyle;
    this.styleChange.emit({ lineStyle: value });
  }

  protected onStartCapChange(event: Event): void {
    const value = (event.target as HTMLSelectElement).value as ConnCap;
    this.styleChange.emit({ startCap: value });
  }

  protected onEndCapChange(event: Event): void {
    const value = (event.target as HTMLSelectElement).value as ConnCap;
    this.styleChange.emit({ endCap: value });
  }

  protected onWidthChange(event: Event): void {
    const raw = Number((event.target as HTMLInputElement).value);
    const width = Number.isFinite(raw) && raw > 0 ? raw : 1;
    this.styleChange.emit({ width });
  }

  protected onColorChange(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.styleChange.emit({ color: value });
  }

  /**
   * Blank input clears the label server-side — emits an explicit `label: null`, distinct from
   * the field simply not being touched at all (US08.7.2 AC3: `undefined` vs `null`).
   */
  protected onLabelChange(event: Event): void {
    const value = (event.target as HTMLInputElement).value.trim();
    this.styleChange.emit({ label: value === '' ? null : value });
  }
}
