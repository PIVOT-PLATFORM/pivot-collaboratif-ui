/**
 * Geometry / interaction constants for the structured whiteboard.
 * Ported from the PouetPouet reference (`board-card-constants.ts`, `board-canvas.tsx`).
 */

/** Minimum card width (sticky / text / table). */
export const MIN_W = 150;
/** Minimum card height (sticky / text / table). */
export const MIN_H = 110;
/** Minimum shape size. */
export const SHAPE_MIN = 80;
/** Minimum label width — deterministic box so resize handles stay aligned. */
export const MIN_LABEL_W = 60;

/** Viewport zoom bounds. */
export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 3;

/** Dotted-grid spacing (canvas pixels). */
export const DOT_SPACING = 24;

/** Smart-alignment snap distance (screen pixels). */
export const ALIGN_SNAP_PX = 6;

/** Card count above which off-screen cards are virtualized. */
export const VIRTUALIZE_THRESHOLD = 100;

/** Undo/redo history depth. */
export const HISTORY_LIMIT = 30;

/** Local cursor emit throttle (ms). */
export const CURSOR_THROTTLE_MS = 50;

/** Paste / duplicate offset (canvas pixels). */
export const PASTE_OFFSET = 16;

/** Default new-card dimensions. */
export const DEFAULT_CARD_W = 180;
export const DEFAULT_CARD_H = 140;
