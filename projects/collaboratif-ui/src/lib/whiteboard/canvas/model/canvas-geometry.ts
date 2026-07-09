import {
  BoundingBox,
  CanvasObject,
  HandlePosition,
  ShapeObject,
  StrokeObject,
  TextObject,
} from './canvas.model';

/** Minimum width/height (canvas px) enforced during handle-based resize — never zero/negative. */
export const MIN_RESIZE_SIZE = 4;

/** Minimum/maximum font size (px) enforced when a text object is resized via a drag handle. */
const MIN_TEXT_FONT_SIZE = 8;
const MAX_TEXT_FONT_SIZE = 400;

/** Returns the bounding box for any canvas object. */
export function getBoundingBox(obj: CanvasObject): BoundingBox {
  switch (obj.kind) {
    case 'shape': return shapeBBox(obj);
    case 'stroke': return strokeBBox(obj);
    case 'text': return textBBox(obj);
  }
}

function shapeBBox(obj: ShapeObject): BoundingBox {
  const x = Math.min(obj.x, obj.x + obj.width);
  const y = Math.min(obj.y, obj.y + obj.height);
  const w = Math.abs(obj.width);
  const h = Math.abs(obj.height);
  return { x, y, width: w, height: h };
}

function strokeBBox(obj: StrokeObject): BoundingBox {
  if (!obj.points.length) return { x: 0, y: 0, width: 0, height: 0 };
  let minX = obj.points[0][0], maxX = obj.points[0][0];
  let minY = obj.points[0][1], maxY = obj.points[0][1];
  for (const [px, py] of obj.points) {
    if (px < minX) minX = px;
    if (px > maxX) maxX = px;
    if (py < minY) minY = py;
    if (py > maxY) maxY = py;
  }
  const pad = obj.lineWidth / 2;
  return { x: minX - pad, y: minY - pad, width: maxX - minX + pad * 2, height: maxY - minY + pad * 2 };
}

function textBBox(obj: TextObject): BoundingBox {
  const approxWidth = obj.content.length * obj.fontSize * 0.6;
  return { x: obj.x, y: obj.y - obj.fontSize, width: Math.max(approxWidth, 20), height: obj.fontSize * 1.4 };
}

/** Returns true if the point (px, py) is inside the given bounding box. */
export function pointInBBox(bbox: BoundingBox, px: number, py: number): boolean {
  return px >= bbox.x && px <= bbox.x + bbox.width && py >= bbox.y && py <= bbox.y + bbox.height;
}

/** Returns true if the given canvas object contains the canvas-space point (px, py). */
export function hitTest(obj: CanvasObject, px: number, py: number): boolean {
  if (obj.kind === 'stroke') {
    const TOLERANCE = Math.max(obj.lineWidth / 2 + 4, 6);
    for (let i = 1; i < obj.points.length; i++) {
      if (distanceToSegment(px, py, obj.points[i - 1], obj.points[i]) <= TOLERANCE) return true;
    }
    return false;
  }
  return pointInBBox(getBoundingBox(obj), px, py);
}

function distanceToSegment(
  px: number, py: number,
  [ax, ay]: [number, number],
  [bx, by]: [number, number],
): number {
  const dx = bx - ax, dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Translates an object by (dx, dy). Returns a new object (immutable update). */
export function translateObject(obj: CanvasObject, dx: number, dy: number): CanvasObject {
  switch (obj.kind) {
    case 'shape':
      return { ...obj, x: obj.x + dx, y: obj.y + dy };
    case 'stroke':
      return { ...obj, points: obj.points.map(([x, y]) => [x + dx, y + dy] as [number, number]) };
    case 'text':
      return { ...obj, x: obj.x + dx, y: obj.y + dy };
  }
}

/**
 * Clamps a bounding box so it never has negative dimensions and its position stays within
 * `[0, canvasW] x [0, canvasH]` (size itself is not capped, only normalised and repositioned).
 */
export function clampBBox(bbox: BoundingBox, canvasW: number, canvasH: number): BoundingBox {
  const width = Math.abs(bbox.width);
  const height = Math.abs(bbox.height);
  const x = Math.max(0, Math.min(bbox.x, canvasW - width));
  const y = Math.max(0, Math.min(bbox.y, canvasH - height));
  return { x, y, width, height };
}

/** Clamps bbox so it never has negative dimensions and x/y within canvas bounds. */
export function clampShape(obj: ShapeObject, canvasW: number, canvasH: number): ShapeObject {
  const clamped = clampBBox(shapeBBox(obj), canvasW, canvasH);
  return { ...obj, x: clamped.x, y: clamped.y, width: clamped.width, height: clamped.height };
}

/**
 * Clamps any canvas object's *position* (stroke points/text origin/shape x-y translated as a
 * whole) so its bounding box stays within canvas bounds — size is left untouched. Generalises
 * {@link clampShape} to strokes and text, reusing {@link translateObject} so every object kind
 * is handled uniformly instead of duplicating per-kind clamp logic.
 */
export function clampObjectToCanvas(obj: CanvasObject, canvasW: number, canvasH: number): CanvasObject {
  if (obj.kind === 'shape') return clampShape(obj, canvasW, canvasH);
  const bbox = getBoundingBox(obj);
  const clamped = clampBBox(bbox, canvasW, canvasH);
  const dx = clamped.x - bbox.x;
  const dy = clamped.y - bbox.y;
  if (dx === 0 && dy === 0) return obj;
  return translateObject(obj, dx, dy);
}

interface HandleEdges {
  left: boolean;
  top: boolean;
  right: boolean;
  bottom: boolean;
}

const NO_EDGES: HandleEdges = { left: false, top: false, right: false, bottom: false };

const HANDLE_EDGES: Record<Exclude<HandlePosition, 'move'>, HandleEdges> = {
  tl: { left: true, top: true, right: false, bottom: false },
  t: { left: false, top: true, right: false, bottom: false },
  tr: { left: false, top: true, right: true, bottom: false },
  l: { left: true, top: false, right: false, bottom: false },
  r: { left: false, top: false, right: true, bottom: false },
  bl: { left: true, top: false, right: false, bottom: true },
  b: { left: false, top: false, right: false, bottom: true },
  br: { left: false, top: false, right: true, bottom: true },
};

/**
 * Computes the resized bounding box obtained by dragging `handle` by (dx, dy) away from
 * `origin` (the union bounding box captured at drag start). Edge(s) opposite the dragged
 * handle stay fixed (the resize anchor, see {@link resizeAnchor}); the moving edge(s) are
 * clamped so width/height never drop below {@link MIN_RESIZE_SIZE} — dragging a handle past
 * the opposite edge stops at the minimum size instead of flipping the shape inside out.
 */
export function resizeBBox(origin: BoundingBox, handle: HandlePosition, dx: number, dy: number): BoundingBox {
  const edges = handle === 'move' ? NO_EDGES : HANDLE_EDGES[handle];
  let left = origin.x;
  let right = origin.x + origin.width;
  let top = origin.y;
  let bottom = origin.y + origin.height;

  if (edges.left) left += dx;
  if (edges.right) right += dx;
  if (edges.top) top += dy;
  if (edges.bottom) bottom += dy;

  if (right - left < MIN_RESIZE_SIZE) {
    if (edges.left) left = right - MIN_RESIZE_SIZE;
    else right = left + MIN_RESIZE_SIZE;
  }
  if (bottom - top < MIN_RESIZE_SIZE) {
    if (edges.top) top = bottom - MIN_RESIZE_SIZE;
    else bottom = top + MIN_RESIZE_SIZE;
  }

  return { x: left, y: top, width: right - left, height: bottom - top };
}

/**
 * Returns the fixed anchor point (the corner/edge opposite the dragged handle) in `origin`
 * coordinates — the point that must stay visually static while the selection is scaled.
 */
export function resizeAnchor(origin: BoundingBox, handle: HandlePosition): { x: number; y: number } {
  const edges = handle === 'move' ? NO_EDGES : HANDLE_EDGES[handle];
  return {
    x: edges.left ? origin.x + origin.width : origin.x,
    y: edges.top ? origin.y + origin.height : origin.y,
  };
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max));
}

/**
 * Scales a canvas object around a fixed anchor point by (scaleX, scaleY) — the core primitive
 * of real per-handle resize (see {@link resizeBBox}/{@link resizeAnchor}): every selected
 * object's original geometry is scaled relative to the same anchor so a multi-object selection
 * resizes proportionally as a group, exactly like a single-object resize.
 *
 * - `shape`: x/y/width/height scaled directly.
 * - `stroke`: every point scaled individually (the stroke's silhouette scales with the bbox).
 * - `text`: position scaled and font size scaled by `scaleY`, clamped to a sane readable range
 *   — text has no stored width/height, only a derived bbox (see {@link textBBox}).
 */
export function scaleObject(
  obj: CanvasObject,
  anchorX: number,
  anchorY: number,
  scaleX: number,
  scaleY: number,
): CanvasObject {
  switch (obj.kind) {
    case 'shape': {
      const bbox = shapeBBox(obj);
      return {
        ...obj,
        x: anchorX + (bbox.x - anchorX) * scaleX,
        y: anchorY + (bbox.y - anchorY) * scaleY,
        width: bbox.width * scaleX,
        height: bbox.height * scaleY,
      };
    }
    case 'stroke': {
      const points = obj.points.map(
        ([px, py]) =>
          [anchorX + (px - anchorX) * scaleX, anchorY + (py - anchorY) * scaleY] as [number, number],
      );
      return { ...obj, points };
    }
    case 'text': {
      const bbox = textBBox(obj);
      const fontSize = clampNumber(obj.fontSize * scaleY, MIN_TEXT_FONT_SIZE, MAX_TEXT_FONT_SIZE);
      const newTop = anchorY + (bbox.y - anchorY) * scaleY;
      const x = anchorX + (obj.x - anchorX) * scaleX;
      return { ...obj, x, y: newTop + fontSize, fontSize };
    }
  }
}
