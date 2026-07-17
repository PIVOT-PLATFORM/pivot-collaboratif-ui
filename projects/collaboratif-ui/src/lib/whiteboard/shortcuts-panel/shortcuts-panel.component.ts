import { ChangeDetectionStrategy, Component, ElementRef, HostListener, afterNextRender, inject, output, viewChild } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { TranslocoPipe } from '@jsverse/transloco';
import { SHORTCUT_BY_TOOL } from '../model/tools';

/**
 * One key badge. A plain string is rendered verbatim (letters, arrows, `?` — nothing to
 * translate); `{ i18n }` is a translation key, for the named keys whose label differs per locale
 * ("Maj"/"Shift", "Suppr"/"Del", "glisser"/"drag"…).
 */
type KeyToken = string | { i18n: string };

/** One row of the cheat-sheet: an i18n label and the keys that trigger it. */
interface ShortcutRow {
  labelKey: string;
  keys: KeyToken[];
}

const CTRL: KeyToken = { i18n: 'whiteboard.shortcuts.keys.ctrl' };
const SHIFT: KeyToken = { i18n: 'whiteboard.shortcuts.keys.shift' };
const ALT: KeyToken = { i18n: 'whiteboard.shortcuts.keys.alt' };
const DRAG: KeyToken = { i18n: 'whiteboard.shortcuts.keys.drag' };

/**
 * Tool rows, built from the single source of truth so a shortcut can never be advertised here
 * while the handler binds another key.
 */
const TOOL_ROWS: readonly ShortcutRow[] = [
  { labelKey: 'whiteboard.toolbar.select', keys: [SHORTCUT_BY_TOOL['select'] ?? ''] },
  { labelKey: 'whiteboard.toolbar.pan', keys: [SHORTCUT_BY_TOOL['pan'] ?? ''] },
  { labelKey: 'whiteboard.toolbar.sticky', keys: [SHORTCUT_BY_TOOL['sticky'] ?? ''] },
  { labelKey: 'whiteboard.toolbar.text', keys: [SHORTCUT_BY_TOOL['text'] ?? ''] },
  { labelKey: 'whiteboard.toolbar.table', keys: [SHORTCUT_BY_TOOL['table'] ?? ''] },
  { labelKey: 'whiteboard.toolbar.frame', keys: [SHORTCUT_BY_TOOL['frame'] ?? ''] },
  { labelKey: 'whiteboard.toolbar.rect', keys: [SHORTCUT_BY_TOOL['rect'] ?? ''] },
  { labelKey: 'whiteboard.toolbar.circle', keys: [SHORTCUT_BY_TOOL['circle'] ?? ''] },
  { labelKey: 'whiteboard.toolbar.diamond', keys: [SHORTCUT_BY_TOOL['diamond'] ?? ''] },
  { labelKey: 'whiteboard.toolbar.triangle', keys: [SHORTCUT_BY_TOOL['triangle'] ?? ''] },
  { labelKey: 'whiteboard.toolbar.line', keys: [SHORTCUT_BY_TOOL['line'] ?? ''] },
  { labelKey: 'whiteboard.toolbar.star', keys: [SHORTCUT_BY_TOOL['star'] ?? ''] },
  { labelKey: 'whiteboard.toolbar.draw', keys: [SHORTCUT_BY_TOOL['draw'] ?? ''] },
  { labelKey: 'whiteboard.toolbar.link', keys: [SHORTCUT_BY_TOOL['link-cards'] ?? ''] },
];

const EDIT_ROWS: readonly ShortcutRow[] = [
  { labelKey: 'whiteboard.shortcuts.undo', keys: [CTRL, 'Z'] },
  { labelKey: 'whiteboard.shortcuts.redo', keys: [CTRL, SHIFT, 'Z'] },
  { labelKey: 'whiteboard.shortcuts.selectAll', keys: [CTRL, 'A'] },
  { labelKey: 'whiteboard.shortcuts.copy', keys: [CTRL, 'C'] },
  { labelKey: 'whiteboard.shortcuts.cut', keys: [CTRL, 'X'] },
  { labelKey: 'whiteboard.shortcuts.paste', keys: [CTRL, 'V'] },
  { labelKey: 'whiteboard.shortcuts.duplicate', keys: [CTRL, 'D'] },
  { labelKey: 'whiteboard.shortcuts.delete', keys: [{ i18n: 'whiteboard.shortcuts.keys.del' }] },
  { labelKey: 'whiteboard.shortcuts.escape', keys: [{ i18n: 'whiteboard.shortcuts.keys.esc' }] },
];

const CANVAS_ROWS: readonly ShortcutRow[] = [
  { labelKey: 'whiteboard.shortcuts.move', keys: ['←', '↑', '↓', '→'] },
  { labelKey: 'whiteboard.shortcuts.moveFast', keys: [SHIFT, '←'] },
  { labelKey: 'whiteboard.shortcuts.multiSelect', keys: [SHIFT, { i18n: 'whiteboard.shortcuts.keys.click' }] },
  { labelKey: 'whiteboard.shortcuts.ratio', keys: [SHIFT, DRAG] },
  { labelKey: 'whiteboard.shortcuts.fromCenter', keys: [ALT, DRAG] },
  { labelKey: 'whiteboard.shortcuts.panGesture', keys: [{ i18n: 'whiteboard.shortcuts.keys.space' }, DRAG] },
  { labelKey: 'whiteboard.shortcuts.zoom', keys: [CTRL, { i18n: 'whiteboard.shortcuts.keys.wheel' }] },
  { labelKey: 'whiteboard.shortcuts.shortcuts', keys: ['?'] },
];

/**
 * The keyboard shortcut cheat-sheet, opened with `?`.
 *
 * A modal dialog rather than a popover: it is a reference the user reads, and dimming the board
 * behind it is the point. The tool rows are derived from `SHORTCUT_BY_TOOL`, so this panel and the
 * key handler can never drift apart.
 */
@Component({
  selector: 'wb-shortcuts-panel',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NgTemplateOutlet, TranslocoPipe],
  templateUrl: './shortcuts-panel.component.html',
  styleUrl: './shortcuts-panel.component.scss',
})
export class ShortcutsPanelComponent {
  /** Emits when the user dismisses the panel (backdrop, close button, or Escape). */
  readonly closePanel = output<void>();

  protected readonly toolRows = TOOL_ROWS;
  protected readonly editRows = EDIT_ROWS;
  protected readonly canvasRows = CANVAS_ROWS;

  private readonly closeBtn = viewChild<ElementRef<HTMLButtonElement>>('closeBtn');
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  constructor() {
    // Move focus into the dialog so a keyboard user lands on it rather than behind it.
    afterNextRender(() => this.closeBtn()?.nativeElement.focus());
  }

  /** Narrows a token for the template — a translation key, or a verbatim string. */
  protected i18nKey(token: KeyToken): string | null {
    return typeof token === 'string' ? null : token.i18n;
  }

  protected dismiss(): void {
    this.closePanel.emit();
  }

  /** A click on the backdrop itself (never on the dialog inside it) dismisses. */
  protected onBackdrop(event: MouseEvent): void {
    if (event.target === event.currentTarget) {
      this.dismiss();
    }
  }

  /**
   * Keeps Tab inside the dialog while it is open (WCAG 2.4.3): a modal that lets focus wander onto
   * the board behind it is a modal in appearance only.
   */
  @HostListener('keydown', ['$event'])
  protected onKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Tab') {
      return;
    }
    const focusables = Array.from(
      this.host.nativeElement.querySelectorAll<HTMLElement>('button:not([disabled])'),
    );
    if (focusables.length === 0) {
      return;
    }
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = this.host.nativeElement.ownerDocument.activeElement;
    if (event.shiftKey && active === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }
}
