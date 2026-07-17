/**
 * Canvas tool modes. Ported from the PouetPouet reference (`floating-toolbar.tsx`).
 */
export type ToolMode =
  | 'select'
  | 'pan'
  | 'text'
  | 'sticky'
  | 'table'
  | 'frame'
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

/**
 * Single-key shortcut → tool, mirroring the Figma/Miro/Klaxoon conventions users already know
 * (`V` select, `H` hand, `T` text, `R` rectangle, `O` oval, `L` line, `P` pencil…). Letters that
 * carry no industry convention follow the French label instead: `N` for *note*, `C` for *cadre*.
 *
 * Bare letters are safe to bind: no other bare-letter shortcut exists on the board, and the
 * board-level handler ignores every key pressed while an input/textarea/contenteditable has focus.
 */
export const TOOL_SHORTCUTS: Readonly<Record<string, ToolMode>> = {
  v: 'select',
  h: 'pan',
  n: 'sticky',
  t: 'text',
  b: 'table',
  c: 'frame',
  r: 'rect',
  o: 'circle',
  d: 'diamond',
  y: 'triangle',
  l: 'line',
  s: 'star',
  p: 'draw',
  f: 'link-cards',
};

/** Reverse of {@link TOOL_SHORTCUTS} — the key to advertise for a tool, uppercased for display. */
export const SHORTCUT_BY_TOOL: Readonly<Partial<Record<ToolMode, string>>> = Object.fromEntries(
  Object.entries(TOOL_SHORTCUTS).map(([key, mode]) => [mode, key.toUpperCase()]),
);

/**
 * Whether a tool places a SHAPE card. Lives here rather than in a component: both the toolbar (to
 * gate the fill picker) and the board container (to pick the tool's hint) need it, and duplicating
 * it would let the two drift apart.
 */
export function isShapeTool(mode: ToolMode): boolean {
  return !!SHAPE_TOOLS[mode];
}

/** Numeric stroke width per named size. */
export const STROKE_WIDTH: Readonly<Record<StrokeSize, number>> = {
  thin: 2,
  medium: 4,
  thick: 8,
};
