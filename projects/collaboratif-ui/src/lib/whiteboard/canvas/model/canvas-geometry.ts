import {
  BoundingBox,
  CanvasObject,
  ShapeObject,
  StrokeObject,
  TextObject,
} from './canvas.model';

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

/** Clamps bbox so it never has negative dimensions and x/y within canvas bounds. */
export function clampShape(obj: ShapeObject, canvasW: number, canvasH: number): ShapeObject {
  const bbox = shapeBBox(obj);
  const x = Math.max(0, Math.min(bbox.x, canvasW - bbox.width));
  const y = Math.max(0, Math.min(bbox.y, canvasH - bbox.height));
  return { ...obj, x, y, width: Math.abs(obj.width), height: Math.abs(obj.height) };
}
