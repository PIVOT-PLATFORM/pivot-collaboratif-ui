import { describe, it, expect } from 'vitest';
import { parseShape, serializeShape, type ShapeSpec } from './shape';

/**
 * Tests for the SHAPE card content codec (US08.6.3) — the pipe-delimited
 * `'{kind}|{stroke}|{fill}|{opacity}|{rotation}'` encoding, byte-compatible with the backend
 * (`ShapeStyleSanitizer`).
 */
describe('shape codec (US08.6.3)', () => {
  it('parses a well-formed content string', () => {
    const spec = parseShape('circle|#112233|#445566|0.5|45');
    expect(spec).toEqual<ShapeSpec>({
      kind: 'circle',
      stroke: '#112233',
      fill: '#445566',
      opacity: 0.5,
      rotation: 45,
    });
  });

  it('falls back to defaults for an unknown kind', () => {
    const spec = parseShape('hexagon|#112233|none|1|0');
    expect(spec.kind).toBe('rect');
  });

  it('falls back to the default stroke colour when missing', () => {
    const spec = parseShape('rect||none|1|0');
    expect(spec.stroke).toBe('#A5B4FC');
  });

  it('treats "none" and an empty fill as no fill', () => {
    expect(parseShape('rect|#A5B4FC|none|1|0').fill).toBeNull();
    expect(parseShape('rect|#A5B4FC||1|0').fill).toBeNull();
  });

  it('defaults opacity to 1 and rotation to 0 when missing', () => {
    const spec = parseShape('rect|#A5B4FC|none');
    expect(spec.opacity).toBe(1);
    expect(spec.rotation).toBe(0);
  });

  it('round-trips through serializeShape', () => {
    const spec: ShapeSpec = { kind: 'diamond', stroke: '#000000', fill: '#ffffff', opacity: 0.8, rotation: 90 };
    expect(parseShape(serializeShape(spec))).toEqual(spec);
  });

  it('serializes a null fill as "none"', () => {
    const content = serializeShape({ kind: 'triangle', stroke: '#A5B4FC', fill: null, opacity: 1, rotation: 0 });
    expect(content).toBe('triangle|#A5B4FC|none|1|0');
  });

  it('every whitelisted kind round-trips', () => {
    const kinds: ShapeSpec['kind'][] = ['rect', 'circle', 'diamond', 'triangle', 'line', 'star'];
    for (const kind of kinds) {
      const spec: ShapeSpec = { kind, stroke: '#A5B4FC', fill: null, opacity: 1, rotation: 0 };
      expect(parseShape(serializeShape(spec)).kind).toBe(kind);
    }
  });
});
