import { describe, it, expect } from 'vitest';
import {
  CARDINAL_SIDES,
  edgeAnchor,
  edgeAnchorPoint,
  nearestEdgeSide,
  type Rect,
} from './board-geometry';

/** The default sticky is wider than tall (180×140 / 192×128) — the case the orientation fix targets. */
const WIDE: Rect = { x: 0, y: 0, width: 192, height: 128 };

describe('board-geometry — edge anchors (ITEM C orientation)', () => {
  it('exposes the four cardinal sides in N/E/S/W order', () => {
    expect(CARDINAL_SIDES).toEqual(['N', 'E', 'S', 'W']);
  });

  it('edgeAnchorPoint returns each edge midpoint of the rect', () => {
    expect(edgeAnchorPoint(WIDE, 'N')).toEqual({ x: 96, y: 0 });
    expect(edgeAnchorPoint(WIDE, 'S')).toEqual({ x: 96, y: 128 });
    expect(edgeAnchorPoint(WIDE, 'E')).toEqual({ x: 192, y: 64 });
    expect(edgeAnchorPoint(WIDE, 'W')).toEqual({ x: 0, y: 64 });
  });

  it('picks the E side when the target is clearly to the right', () => {
    const to: Rect = { x: 500, y: 0, width: 192, height: 128 };
    expect(edgeAnchor(WIDE, to).side).toBe('E');
  });

  it('picks the S side for a vertically-stacked wide card (regression: no more horizontal bias)', () => {
    // Centres: from (96,64), to (96, 314). Raw |dx|=0 < |dy|=250 → S either way here, but this
    // guards the vertical case explicitly.
    const to: Rect = { x: 0, y: 250, width: 192, height: 128 };
    expect(edgeAnchor(WIDE, to).side).toBe('S');
  });

  it('normalises by half-extent: a diagonal offset the raw rule would call horizontal resolves vertical', () => {
    // Centres: from (96,64), to (306, 244) → dx=210, dy=180.
    // Raw |dx|>|dy| → E (horizontal bar). Normalised: 210/96=2.19 < 180/64=2.81 → S (vertical).
    const to: Rect = { x: 210, y: 180, width: 192, height: 128 };
    expect(edgeAnchor(WIDE, to).side).toBe('S');
  });

  it('returns the anchor point matching the chosen side', () => {
    const to: Rect = { x: 500, y: 0, width: 192, height: 128 };
    const a = edgeAnchor(WIDE, to);
    expect({ x: a.x, y: a.y }).toEqual(edgeAnchorPoint(WIDE, 'E'));
  });
});

describe('board-geometry — nearestEdgeSide (ITEM B anchor snapping)', () => {
  it('returns the side whose midpoint is closest to the pointer', () => {
    expect(nearestEdgeSide(WIDE, { x: 190, y: 60 })).toBe('E');
    expect(nearestEdgeSide(WIDE, { x: 96, y: 5 })).toBe('N');
    expect(nearestEdgeSide(WIDE, { x: 96, y: 125 })).toBe('S');
    expect(nearestEdgeSide(WIDE, { x: 2, y: 60 })).toBe('W');
  });
});
