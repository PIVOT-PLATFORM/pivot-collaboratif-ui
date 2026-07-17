/**
 * SHAPE card content encoding. Ported from the PouetPouet reference
 * (`board-card-shape.tsx`). A SHAPE card's `content` is
 * `'type|stroke|fill|opacity[|rotation][|diag]'`.
 */

export type ShapeKind = 'rect' | 'circle' | 'diamond' | 'triangle' | 'line' | 'star';

/**
 * Which diagonal of its bounding box a `line` runs along: top-left→bottom-right, or
 * bottom-left→top-right. Any two-point segment is the diagonal of some rectangle, so this single
 * bit plus the box covers every angle — and lets a line reuse the whole existing box machinery
 * (resize, move, marquee, Shift-ratio) instead of needing its own geometry.
 */
export type ShapeDiag = 'tlbr' | 'bltr';

export interface ShapeSpec {
  kind: ShapeKind;
  stroke: string;
  fill: string | null;
  opacity: number;
  rotation: number;
  /**
   * Only meaningful for `kind: 'line'`; ignored by every other shape — hence optional, so the
   * other five kinds are not forced to carry a value that says nothing about them.
   * {@link parseShape} always resolves it, so rendering never has to handle `undefined`.
   */
  diag?: ShapeDiag;
}

const SHAPE_KINDS: ReadonlySet<string> = new Set(['rect', 'circle', 'diamond', 'triangle', 'line', 'star']);

/** Parses a SHAPE card's content string, with safe defaults. */
export function parseShape(content: string): ShapeSpec {
  const [kind, stroke, fill, opacity, rotation, diag] = content.split('|');
  return {
    kind: SHAPE_KINDS.has(kind) ? (kind as ShapeKind) : 'rect',
    stroke: stroke || '#A5B4FC',
    fill: fill && fill !== 'none' ? fill : null,
    opacity: opacity !== undefined && opacity !== '' ? Number(opacity) : 1,
    rotation: rotation ? Number(rotation) : 0,
    // Trailing segment: a line saved before it existed simply has no 6th field and keeps the
    // top-left→bottom-right default, which is what its box already described.
    diag: diag === 'bltr' ? 'bltr' : 'tlbr',
  };
}

/** Serializes a SHAPE spec back to card content. */
export function serializeShape(s: ShapeSpec): string {
  return `${s.kind}|${s.stroke}|${s.fill ?? 'none'}|${s.opacity}|${s.rotation}|${s.diag ?? 'tlbr'}`;
}
