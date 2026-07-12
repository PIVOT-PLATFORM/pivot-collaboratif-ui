/**
 * Canvas tool modes. Ported from the PouetPouet reference (`floating-toolbar.tsx`).
 */
export type ToolMode =
  | 'select'
  | 'pan'
  | 'text'
  | 'sticky'
  | 'table'
  | 'rect'
  | 'circle'
  | 'diamond'
  | 'triangle'
  | 'line'
  | 'star'
  | 'draw'
  | 'link'
  | 'link-cards';

export type StrokeSize = 'thin' | 'medium' | 'thick';

/** Tool modes that place a shape card; maps a tool to the SHAPE kind it creates. */
export const SHAPE_TOOLS: Readonly<Record<string, string>> = {
  rect: 'rect',
  circle: 'circle',
  diamond: 'diamond',
  triangle: 'triangle',
  line: 'line',
  star: 'star',
};

/** Numeric stroke width per named size. */
export const STROKE_WIDTH: Readonly<Record<StrokeSize, number>> = {
  thin: 2,
  medium: 4,
  thick: 8,
};
