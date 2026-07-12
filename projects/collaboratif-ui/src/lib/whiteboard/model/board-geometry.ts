/**
 * Pure geometry helpers for the structured whiteboard — viewport transforms,
 * bounding boxes, connection edge-anchoring. Ported from the interaction math in
 * the PouetPouet `board-canvas.tsx` / `connection-line.tsx`.
 */
import type { Card, Frame } from './board.types';

/** Canvas viewport: pan offset (screen px) + zoom factor. */
export interface Viewport {
  x: number;
  y: number;
  zoom: number;
}

/** Axis-aligned rectangle in canvas (board) coordinates. */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Screen point → canvas (board) point, given a viewport. */
export function screenToCanvas(sx: number, sy: number, vp: Viewport): { x: number; y: number } {
  return { x: (sx - vp.x) / vp.zoom, y: (sy - vp.y) / vp.zoom };
}

/** Canvas (board) point → screen point, given a viewport. */
export function canvasToScreen(cx: number, cy: number, vp: Viewport): { x: number; y: number } {
  return { x: cx * vp.zoom + vp.x, y: cy * vp.zoom + vp.y };
}

/** Bounding rect of a card. */
export function cardRect(c: Pick<Card, 'posX' | 'posY' | 'width' | 'height'>): Rect {
  return { x: c.posX, y: c.posY, width: c.width, height: c.height };
}

/** Bounding rect of a frame. */
export function frameRect(f: Pick<Frame, 'posX' | 'posY' | 'width' | 'height'>): Rect {
  return { x: f.posX, y: f.posY, width: f.width, height: f.height };
}

/** True if point (px,py) is inside rect. */
export function pointInRect(px: number, py: number, r: Rect): boolean {
  return px >= r.x && px <= r.x + r.width && py >= r.y && py <= r.y + r.height;
}

/** True if two rects overlap (used for marquee selection). */
export function rectsIntersect(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

/** Center point of a rect. */
export function rectCenter(r: Rect): { x: number; y: number } {
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
}

/** Bounding box enclosing a set of rects (null when empty). */
export function unionRect(rects: Rect[]): Rect | null {
  if (rects.length === 0) {
    return null;
  }
  const minX = Math.min(...rects.map((r) => r.x));
  const minY = Math.min(...rects.map((r) => r.y));
  const maxX = Math.max(...rects.map((r) => r.x + r.width));
  const maxY = Math.max(...rects.map((r) => r.y + r.height));
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

export type EdgeSide = 'N' | 'S' | 'E' | 'W';

/**
 * Picks the anchor point on `from`'s edge facing `to`'s center, plus the edge side.
 * Mirrors the N/S/E/W edge-anchoring used by connection routing.
 */
export function edgeAnchor(from: Rect, to: Rect): { x: number; y: number; side: EdgeSide } {
  const fc = rectCenter(from);
  const tc = rectCenter(to);
  const dx = tc.x - fc.x;
  const dy = tc.y - fc.y;
  if (Math.abs(dx) > Math.abs(dy)) {
    return dx >= 0
      ? { x: from.x + from.width, y: fc.y, side: 'E' }
      : { x: from.x, y: fc.y, side: 'W' };
  }
  return dy >= 0
    ? { x: fc.x, y: from.y + from.height, side: 'S' }
    : { x: fc.x, y: from.y, side: 'N' };
}
