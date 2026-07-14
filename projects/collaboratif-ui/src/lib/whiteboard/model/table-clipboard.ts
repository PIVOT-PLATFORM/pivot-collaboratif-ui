/**
 * Spreadsheet-paste priority resolution for TABLE cards (US08.6.6, parity spec §4.8 ranks 1
 * & 4) — ported from the PouetPouet reference (`board-canvas.tsx` / `lib/table-clipboard.ts`).
 *
 * Pure, DOM-free decision logic: reading the actual `ClipboardEvent`/`document.activeElement`
 * happens at the call site ({@link StructuredCanvasComponent}), which builds a
 * {@link TablePasteContext} and hands it to {@link decideTablePaste}. Keeping this file free of
 * `ClipboardEvent`/`HTMLElement` makes every branch of the priority order directly unit-testable.
 *
 * Priority order implemented here (§4.8):
 * 1. A TABLE card's cell has focus + tabular content → fills *that* card's grid. Prioritised
 *    over the generic "focus in an editable field → no-op" guard (rank 2, owned by whichever
 *    US wires the rest of the paste pipeline — this module only ever returns `'none'` for that
 *    case, leaving the native paste to proceed).
 * 4. Otherwise, tabular content (HTML `<table>` first, TSV fallback — see `parseClipboardTable`
 *    in `table.ts`) with a single TABLE card selected → fills it; no/multiple selection →
 *    creates a new TABLE card dimensioned per {@link computeTableCardSize}.
 *
 * Non-tabular `text/plain` (no tab, no `<table>`) that reaches none of the above falls back to
 * plain-text card creation (US08.6.1) — the one non-TABLE outcome this module still resolves,
 * because AC7 of US08.6.6 explicitly requires it not be mistaken for a table.
 */
import { parseClipboardTable } from './table';
import { MIN_H } from './board-constants';

/** Minimum TABLE card width (§4.8 clamp floor). */
export const TABLE_CARD_MIN_W = 180;
/** Maximum TABLE card width (§4.8 clamp ceiling). */
export const TABLE_CARD_MAX_W = 720;
/** Maximum TABLE card height (§4.8 clamp ceiling). */
export const TABLE_CARD_MAX_H = 600;
/** Per-column width contribution (§4.8: `w = clamp(cols*120, 180, 720)`). */
export const TABLE_CARD_COL_W = 120;
/** Per-row height contribution (§4.8: `h = clamp(16 + rows*30, min, 600)`). */
export const TABLE_CARD_ROW_H = 30;
/** Fixed height base before the per-row contribution (§4.8). */
export const TABLE_CARD_H_BASE = 16;

/** `w = clamp(cols * 120, 180, 720)` (§4.8). */
export function clampTableWidth(cols: number): number {
  return Math.min(TABLE_CARD_MAX_W, Math.max(TABLE_CARD_MIN_W, cols * TABLE_CARD_COL_W));
}

/** `h = clamp(16 + rows * 30, MIN_H, 600)` (§4.8) — the clamp floor is the whiteboard's
 *  existing minimum card height ({@link MIN_H}), consistent with every other card kind. */
export function clampTableHeight(rows: number): number {
  return Math.min(TABLE_CARD_MAX_H, Math.max(MIN_H, TABLE_CARD_H_BASE + rows * TABLE_CARD_ROW_H));
}

/** Computes the exact `{ width, height }` a newly-created, pasted TABLE card must have. */
export function computeTableCardSize(cols: number, rows: number): { width: number; height: number } {
  return { width: clampTableWidth(cols), height: clampTableHeight(rows) };
}

/** The resolved outcome of a paste event, for the caller to apply. */
export type TablePasteAction =
  | { kind: 'fill'; cardId: string; rows: string[][] }
  | { kind: 'create'; rows: string[][]; width: number; height: number }
  | { kind: 'fallback-text'; text: string }
  | { kind: 'none' };

/** Everything {@link decideTablePaste} needs, pre-extracted from the DOM by the caller. */
export interface TablePasteContext {
  /** `event.clipboardData.getData('text/html')`, if any. */
  html?: string;
  /** `event.clipboardData.getData('text/plain')`, if any. */
  text?: string;
  /** Id of the TABLE card whose cell currently has focus, or `null` (§4.8 rank 1). */
  focusedTableCardId: string | null;
  /** Id of the single selected TABLE card, or `null` when 0 or >1 cards are selected. */
  singleSelectedTableCardId: string | null;
  /** Whether the current focus is an editable field (input/textarea/contenteditable) other
   *  than a TABLE cell — the generic "no-op while typing" guard (§4.8 rank 2). */
  isEditableFieldFocus: boolean;
}

/** Tabular-content recognition threshold (§4.8): `>1` row or `>1` column — a single 1×1 value
 *  is plain text, not a table, regardless of source (HTML `<table>` or TSV). */
function isTabular(rows: string[][] | null): rows is string[][] {
  return !!rows && rows.length > 0 && (rows.length > 1 || rows[0].length > 1);
}

/**
 * Resolves what a paste event should do, per the priority order documented at the top of this
 * file. Never mutates anything — the caller applies the returned {@link TablePasteAction}.
 */
export function decideTablePaste(ctx: TablePasteContext): TablePasteAction {
  const rows = parseClipboardTable(ctx.html, ctx.text);

  if (isTabular(rows)) {
    if (ctx.focusedTableCardId) {
      return { kind: 'fill', cardId: ctx.focusedTableCardId, rows };
    }
    if (ctx.isEditableFieldFocus) {
      return { kind: 'none' };
    }
    if (ctx.singleSelectedTableCardId) {
      return { kind: 'fill', cardId: ctx.singleSelectedTableCardId, rows };
    }
    const { width, height } = computeTableCardSize(rows[0].length, rows.length);
    return { kind: 'create', rows, width, height };
  }

  // Not tabular: a focused TABLE cell or another editable field handles its own plain-text
  // paste natively — never our concern once the content isn't a recognized table.
  if (ctx.focusedTableCardId || ctx.isEditableFieldFocus) {
    return { kind: 'none' };
  }
  const trimmed = (ctx.text ?? '').trim();
  return trimmed ? { kind: 'fallback-text', text: trimmed } : { kind: 'none' };
}
