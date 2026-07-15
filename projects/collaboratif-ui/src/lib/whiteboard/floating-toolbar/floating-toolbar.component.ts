import { ChangeDetectionStrategy, Component, ElementRef, computed, input, output, viewChild } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { SHAPE_TOOLS, type ToolMode } from '../model/tools';
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
  { mode: 'frame', icon: '⬜', labelKey: 'whiteboard.toolbar.frame' },
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
  /** Currently selected drawing colour (stroke colour for SHAPE tools). */
  readonly color = input<string>('#A5B4FC');
  /**
   * Currently selected fill colour for a SHAPE tool, or `null` for no fill (transparent) —
   * US08.6.3, second colour picker distinct from the stroke {@link color}. Ignored for every
   * non-SHAPE tool.
   */
  readonly fillColor = input<string | null>(null);
  /** Whether the palette is disabled (read-only board). */
  readonly disabled = input<boolean>(false);

  /** Emits when the user picks a tool. */
  readonly toolChange = output<ToolMode>();
  /** Emits when the user picks a colour. */
  readonly colorChange = output<string>();
  /** Emits when the user picks a fill colour, or `null` for "no fill". */
  readonly fillColorChange = output<string | null>();
  /** Emits the selected file once the user picks one via the "insert image" button
   *  (US08.6.4 — accessible upload entry point, not only drag-and-drop/paste). */
  readonly insertImage = output<File>();

  protected readonly tools = TOOLS;
  protected readonly palette = BASE_COLORS;

  /** Whether the active tool places a SHAPE card — gates the fill colour picker's visibility. */
  protected readonly isShapeTool = computed(() => !!SHAPE_TOOLS[this.tool()]);
  private readonly imageInput = viewChild<ElementRef<HTMLInputElement>>('imageInput');

  protected pick(mode: ToolMode): void {
    if (!this.disabled()) {
      this.toolChange.emit(mode);
    }
  }

  /** Opens the hidden file picker for image insertion. */
  protected pickImageFile(): void {
    if (!this.disabled()) {
      this.imageInput()?.nativeElement.click();
    }
  }

  /** Handles the hidden `<input type="file">` selection, then resets it so the same file can
   *  be re-selected consecutively (the `change` event does not fire on an unchanged value). */
  protected onImageInputChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file) {
      this.insertImage.emit(file);
    }
    input.value = '';
  }
}
