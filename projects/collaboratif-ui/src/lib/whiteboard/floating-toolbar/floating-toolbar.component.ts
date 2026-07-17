import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  HostListener,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { TranslocoPipe } from '@jsverse/transloco';
import { SHORTCUT_BY_TOOL, isShapeTool, type ToolMode } from '../model/tools';
import { BASE_COLORS } from '../model/colors';
import { WbTooltipDirective } from '../tooltip/wb-tooltip.directive';

/** A single-tool button (non-shape) in the palette. */
interface ToolButton {
  mode: ToolMode;
  labelKey: string;
}

/** SHAPE tools, grouped behind the "Formes" fly-out (a submenu, not a flat list). */
type ShapeMode = 'rect' | 'circle' | 'diamond' | 'triangle' | 'line' | 'star';
const SHAPES: readonly ShapeMode[] = ['rect', 'circle', 'diamond', 'triangle', 'line', 'star'];

/** Pointer tools — always the first group. */
const POINTER_TOOLS: readonly ToolButton[] = [
  { mode: 'select', labelKey: 'whiteboard.toolbar.select' },
  { mode: 'pan', labelKey: 'whiteboard.toolbar.pan' },
];

/** Content-placing tools (image is a separate action — see {@link insertImage}). */
const CONTENT_TOOLS: readonly ToolButton[] = [
  { mode: 'sticky', labelKey: 'whiteboard.toolbar.sticky' },
  { mode: 'text', labelKey: 'whiteboard.toolbar.text' },
  { mode: 'table', labelKey: 'whiteboard.toolbar.table' },
  { mode: 'frame', labelKey: 'whiteboard.toolbar.frame' },
];

/** Free-draw + connector tools — the last group. */
const DRAW_TOOLS: readonly ToolButton[] = [
  { mode: 'draw', labelKey: 'whiteboard.toolbar.draw' },
];

/** Which transient fly-out / popover is open, if any. */
type OpenMenu = 'shapes' | 'colors' | null;

const COLLAPSE_STORAGE_KEY = 'wb-toolbar-collapsed';

function isShapeMode(mode: ToolMode): mode is ShapeMode {
  return isShapeTool(mode);
}

/** Reads the persisted collapsed state (session-scoped, browser only). */
function readCollapsed(): boolean {
  if (typeof sessionStorage === 'undefined') {
    return false;
  }
  try {
    return sessionStorage.getItem(COLLAPSE_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * Left-hand floating tool palette. Ported from the PouetPouet reference
 * (`floating-toolbar.tsx`) — a **retractable** vertical bar whose related tools are grouped
 * into **submenus/fly-outs** (SHAPE tools behind a "Formes" button, colours behind a popover)
 * rather than a long flat list.
 *
 * Purely presentational: the active tool + colours are owned by the canvas/container. The
 * component's output contract is unchanged from the flat version — {@link toolChange},
 * {@link colorChange}, {@link fillColorChange} and {@link insertImage} are the only surface the
 * canvas consumes, and their semantics are identical.
 */
@Component({
  selector: 'wb-floating-toolbar',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NgTemplateOutlet, TranslocoPipe, WbTooltipDirective],
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

  protected readonly pointerTools = POINTER_TOOLS;
  protected readonly contentTools = CONTENT_TOOLS;
  protected readonly drawTools = DRAW_TOOLS;
  protected readonly shapes = SHAPES;
  protected readonly palette = BASE_COLORS;

  /** Whether the retractable bar is collapsed to just its expand handle (session-persisted). */
  protected readonly collapsed = signal<boolean>(readCollapsed());
  /** The currently open submenu/popover, or `null`. */
  protected readonly openMenu = signal<OpenMenu>(null);
  /** Last SHAPE the user placed — restored by the grouped "Formes" button. */
  protected readonly lastShape = signal<ShapeMode>('rect');

  /** Whether the active tool places a SHAPE card — gates the fill colour picker's visibility. */
  protected readonly isShapeTool = computed(() => isShapeMode(this.tool()));
  /** The glyph shown on the grouped "Formes" button (active shape, else last used). */
  protected readonly shapeGlyph = computed<ShapeMode>(() => {
    const current = this.tool();
    return isShapeMode(current) ? current : this.lastShape();
  });

  /** The keyboard shortcut to advertise on a tool's tooltip, or `null` if it has none. */
  protected shortcutFor(mode: ToolMode): string | null {
    return SHORTCUT_BY_TOOL[mode] ?? null;
  }


  private readonly imageInput = viewChild<ElementRef<HTMLInputElement>>('imageInput');
  private readonly host = inject(ElementRef<HTMLElement>);

  constructor() {
    // Remember the most recently used shape so the grouped button restores it.
    effect(() => {
      const current = this.tool();
      if (isShapeMode(current)) {
        this.lastShape.set(current);
      }
    });
    // Persist the collapsed state for the rest of the session.
    effect(() => {
      const value = this.collapsed();
      if (typeof sessionStorage === 'undefined') {
        return;
      }
      try {
        sessionStorage.setItem(COLLAPSE_STORAGE_KEY, value ? '1' : '0');
      } catch {
        /* storage unavailable — non-fatal */
      }
    });
  }

  /** Toggles the retractable bar. Collapsing also dismisses any open submenu. */
  protected toggleCollapsed(): void {
    this.openMenu.set(null);
    this.collapsed.update((v) => !v);
  }

  protected pick(mode: ToolMode): void {
    if (this.disabled()) {
      return;
    }
    this.openMenu.set(null);
    this.toolChange.emit(mode);
  }

  /** Opens the SHAPE submenu and activates the last-used shape (grouped "Formes" button). */
  protected toggleShapes(): void {
    if (this.disabled()) {
      return;
    }
    const willOpen = this.openMenu() !== 'shapes';
    this.openMenu.set(willOpen ? 'shapes' : null);
    if (willOpen && !isShapeMode(this.tool())) {
      this.toolChange.emit(this.lastShape());
    }
  }

  /** Picks a SHAPE from the submenu — remembers it and keeps the submenu open to switch quickly. */
  protected pickShape(shape: ShapeMode): void {
    if (this.disabled()) {
      return;
    }
    this.lastShape.set(shape);
    this.toolChange.emit(shape);
  }

  /** Toggles the colour popover. */
  protected toggleColors(): void {
    if (this.disabled()) {
      return;
    }
    this.openMenu.update((m) => (m === 'colors' ? null : 'colors'));
  }

  protected chooseColor(color: string): void {
    this.colorChange.emit(color);
  }

  protected chooseFill(color: string | null): void {
    this.fillColorChange.emit(color);
  }

  /** Opens the hidden file picker for image insertion. */
  protected pickImageFile(): void {
    if (!this.disabled()) {
      this.openMenu.set(null);
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

  /** Escape closes an open submenu first (before the canvas resets the tool). */
  @HostListener('keydown.escape', ['$event'])
  protected onEscape(event: Event): void {
    if (this.openMenu() !== null) {
      event.stopPropagation();
      this.openMenu.set(null);
    }
  }

  /** A click outside the toolbar dismisses any open submenu. */
  @HostListener('document:pointerdown', ['$event'])
  protected onDocumentPointerDown(event: Event): void {
    if (this.openMenu() !== null && !this.host.nativeElement.contains(event.target as Node)) {
      this.openMenu.set(null);
    }
  }
}
