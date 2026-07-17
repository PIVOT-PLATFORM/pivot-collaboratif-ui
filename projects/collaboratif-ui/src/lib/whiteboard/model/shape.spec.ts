import { describe, it, expect } from 'vitest';
import { parseShape, serializeShape, type ShapeSpec } from './shape';

/**
 * Tests for the SHAPE card content codec (US08.6.3) — the pipe-delimited
 * `'{kind}|{stroke}|{fill}|{opacity}|{rotation}|{diag}'` encoding, byte-compatible with the
 * backend (`ShapeStyleSanitizer`, which rebuilds the string field by field and would drop any
 * segment it does not know — see collaboratif-core#103).
 */
describe('shape codec (US08.6.3)', () => {
  it('parses a well-formed content string', () => {
    const spec = parseShape('circle|#112233|#445566|0.5|45|bltr');
    expect(spec).toEqual<ShapeSpec>({
      kind: 'circle',
      stroke: '#112233',
      fill: '#445566',
      opacity: 0.5,
      rotation: 45,
      diag: 'bltr',
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
    const spec: ShapeSpec = { kind: 'diamond', stroke: '#000000', fill: '#ffffff', opacity: 0.8, rotation: 90, diag: 'tlbr' };
    expect(parseShape(serializeShape(spec))).toEqual(spec);
  });

  it('serializes a null fill as "none"', () => {
    const content = serializeShape({ kind: 'triangle', stroke: '#A5B4FC', fill: null, opacity: 1, rotation: 0 });
    expect(content).toBe('triangle|#A5B4FC|none|1|0|tlbr');
  });

  /**
   * A line is the diagonal of its box — `diag` says which one, so it is what makes any angle
   * reachable. Losing it would silently flip a "\"-oriented line to "/".
   */
  it('round-trips a line diagonal', () => {
    const spec: ShapeSpec = { kind: 'line', stroke: '#A5B4FC', fill: null, opacity: 1, rotation: 0, diag: 'bltr' };
    expect(parseShape(serializeShape(spec)).diag).toBe('bltr');
  });

  /** Every SHAPE stored before the field existed has five segments — they must stay readable. */
  it('defaults the diagonal for content saved before the field existed', () => {
    expect(parseShape('line|#A5B4FC|none|1|0').diag).toBe('tlbr');
  });

  /** Same closed-set treatment as `kind`: a crafted value never reaches the renderer. */
  it('falls back to the default for an unknown diagonal', () => {
    expect(parseShape('line|#A5B4FC|none|1|0|sideways').diag).toBe('tlbr');
  });

  /** The shape a caller omits `diag` on is serialized with the default, never `undefined`. */
  it('serializes a missing diagonal as the default rather than "undefined"', () => {
    expect(serializeShape({ kind: 'rect', stroke: '#A5B4FC', fill: null, opacity: 1, rotation: 0 })).toBe(
      'rect|#A5B4FC|none|1|0|tlbr',
    );
  });

  it('every whitelisted kind round-trips', () => {
    const kinds: ShapeSpec['kind'][] = ['rect', 'circle', 'diamond', 'triangle', 'line', 'star'];
    for (const kind of kinds) {
      const spec: ShapeSpec = { kind, stroke: '#A5B4FC', fill: null, opacity: 1, rotation: 0 };
      expect(parseShape(serializeShape(spec)).kind).toBe(kind);
    }
  });
});
