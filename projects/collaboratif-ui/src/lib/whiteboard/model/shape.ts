/**
 * SHAPE card content encoding. Ported from the PouetPouet reference
 * (`board-card-shape.tsx`). A SHAPE card's `content` is `'type|stroke|fill|opacity[|rotation]'`.
 */

export type ShapeKind = 'rect' | 'circle' | 'diamond' | 'triangle' | 'line' | 'star';

export interface ShapeSpec {
  kind: ShapeKind;
  stroke: string;
  fill: string | null;
  opacity: number;
  rotation: number;
}

const SHAPE_KINDS: ReadonlySet<string> = new Set(['rect', 'circle', 'diamond', 'triangle', 'line', 'star']);

/** Parses a SHAPE card's content string, with safe defaults. */
export function parseShape(content: string): ShapeSpec {
  const [kind, stroke, fill, opacity, rotation] = content.split('|');
  return {
    kind: SHAPE_KINDS.has(kind) ? (kind as ShapeKind) : 'rect',
    stroke: stroke || '#A5B4FC',
    fill: fill && fill !== 'none' ? fill : null,
    opacity: opacity !== undefined && opacity !== '' ? Number(opacity) : 1,
    rotation: rotation ? Number(rotation) : 0,
  };
}

/** Serializes a SHAPE spec back to card content. */
export function serializeShape(s: ShapeSpec): string {
  return `${s.kind}|${s.stroke}|${s.fill ?? 'none'}|${s.opacity}|${s.rotation}`;
}
