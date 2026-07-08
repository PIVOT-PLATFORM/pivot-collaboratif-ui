/** Active drawing tool on the whiteboard canvas. */
export type CanvasTool = 'select' | 'pencil' | 'rectangle' | 'ellipse' | 'text' | 'erase';

/** Base properties shared by all canvas objects. */
export interface CanvasObjectBase {
  /** Server-generated UUID — also used as local ID before sync. */
  id: string;
  /** Optional group UUID; objects sharing a groupId move as a unit. */
  groupId?: string;
  strokeColor: string;
  fillColor: string;
  lineWidth: number;
}

/** A free-hand pencil stroke stored as a series of (x, y) points. */
export interface StrokeObject extends CanvasObjectBase {
  kind: 'stroke';
  points: [number, number][];
}

/** A rectangle or ellipse shape. */
export interface ShapeObject extends CanvasObjectBase {
  kind: 'shape';
  shape: 'rectangle' | 'ellipse';
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A text label positioned at (x, y). Content is capped at 500 characters. */
export interface TextObject extends CanvasObjectBase {
  kind: 'text';
  x: number;
  y: number;
  content: string;
  fontSize: number;
}

export type CanvasObject = StrokeObject | ShapeObject | TextObject;

/** Axis-aligned bounding box of a canvas object. */
export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A pair of guide lines to display during snapped drag. */
export interface AlignGuide {
  /** Vertical guide x coordinate (in canvas space), or null if none. */
  x: number | null;
  /** Horizontal guide y coordinate (in canvas space), or null if none. */
  y: number | null;
}

/** Resize handle positions (8-point + move). */
export type HandlePosition =
  | 'tl' | 't' | 'tr'
  | 'l'  |       'r'
  | 'bl' | 'b' | 'br'
  | 'move';

/** 12-colour palette aligned with @pivot/design-system (EN17.2 placeholder). */
export const COLOR_PALETTE: readonly string[] = [
  '#E91E63', '#9C27B0', '#3F51B5', '#2196F3',
  '#00BCD4', '#009688', '#4CAF50', '#8BC34A',
  '#FFC107', '#FF9800', '#FF5722', '#795548',
];

/** Regex for strict hex colour validation — prevents CSS injection. */
export const HEX_REGEX = /^#[0-9A-Fa-f]{6}$/;

/** Maximum characters in a text object (truncated on input). */
export const MAX_TEXT_LENGTH = 500;

/** Handle size in CSS pixels (device-independent). */
export const HANDLE_SIZE = 8;

/** Snap tolerance for smart alignment guides (canvas pixels). */
export const SNAP_TOLERANCE = 8;

/** Duplicate offset (canvas pixels). */
export const DUPLICATE_OFFSET = 16;

/** Undo stack size limit. */
export const UNDO_STACK_LIMIT = 50;
