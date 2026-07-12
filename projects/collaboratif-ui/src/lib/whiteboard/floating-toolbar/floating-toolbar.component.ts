import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import type { ToolMode } from '../model/tools';
import { BASE_COLORS } from '../model/colors';

interface ToolButton {
  mode: ToolMode;
  icon: string;
  labelKey: string;
}

/** Primary tools shown in the left palette (a subset of {@link ToolMode}). */
const TOOLS: readonly ToolButton[] = [
  { mode: 'select', icon: '⬚', labelKey: 'whiteboard.toolbar.select' },
  { mode: 'pan', icon: '✋', labelKey: 'whiteboard.toolbar.pan' },
  { mode: 'sticky', icon: '🗒️', labelKey: 'whiteboard.toolbar.sticky' },
  { mode: 'text', icon: 'T', labelKey: 'whiteboard.toolbar.text' },
  { mode: 'rect', icon: '▭', labelKey: 'whiteboard.toolbar.rect' },
  { mode: 'circle', icon: '◯', labelKey: 'whiteboard.toolbar.circle' },
  { mode: 'diamond', icon: '◇', labelKey: 'whiteboard.toolbar.diamond' },
  { mode: 'triangle', icon: '△', labelKey: 'whiteboard.toolbar.triangle' },
  { mode: 'line', icon: '╱', labelKey: 'whiteboard.toolbar.line' },
  { mode: 'star', icon: '★', labelKey: 'whiteboard.toolbar.star' },
  { mode: 'draw', icon: '✏️', labelKey: 'whiteboard.toolbar.draw' },
  { mode: 'table', icon: '▦', labelKey: 'whiteboard.toolbar.table' },
  { mode: 'link-cards', icon: '↔', labelKey: 'whiteboard.toolbar.link' },
];

/**
 * Left-hand floating tool palette. Ported from the PouetPouet reference
 * (`floating-toolbar.tsx`) — selects the active {@link ToolMode} and the drawing colour.
 * Purely presentational: the active tool + colour are owned by the canvas/container.
 */
@Component({
  selector: 'wb-floating-toolbar',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslocoPipe],
  templateUrl: './floating-toolbar.component.html',
  styleUrl: './floating-toolbar.component.scss',
})
export class FloatingToolbarComponent {
  /** Currently active tool. */
  readonly tool = input<ToolMode>('select');
  /** Currently selected drawing colour. */
  readonly color = input<string>('#A5B4FC');
  /** Whether the palette is disabled (read-only board). */
  readonly disabled = input<boolean>(false);

  /** Emits when the user picks a tool. */
  readonly toolChange = output<ToolMode>();
  /** Emits when the user picks a colour. */
  readonly colorChange = output<string>();

  protected readonly tools = TOOLS;
  protected readonly palette = BASE_COLORS;

  protected pick(mode: ToolMode): void {
    if (!this.disabled()) {
      this.toolChange.emit(mode);
    }
  }
}
