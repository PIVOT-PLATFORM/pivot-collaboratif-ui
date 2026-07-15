import { describe, expect, it } from 'vitest';
import {
  accessibleInkColor,
  accessibleTextColorFor,
  contrastRatio,
  relativeLuminance,
  WCAG_AA_TEXT_CONTRAST_RATIO,
} from './colors';

describe('colors — WCAG contrast helpers (US08.6.1 A11y AC)', () => {
  it('gives black a near-zero relative luminance and white a luminance of 1', () => {
    expect(relativeLuminance('#000000')).toBeCloseTo(0, 5);
    expect(relativeLuminance('#FFFFFF')).toBeCloseTo(1, 5);
  });

  it('computes the maximum 21:1 contrast ratio between pure black and white', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 0);
  });

  it('computes a 1:1 contrast ratio for identical colours', () => {
    expect(contrastRatio('#FFEB3B', '#FFEB3B')).toBeCloseTo(1, 5);
  });

  it('picks near-black ink for a light background', () => {
    expect(accessibleInkColor('#FFEB3B')).toBe('#111827');
  });

  it('picks white ink for a near-black background', () => {
    expect(accessibleInkColor('#111827')).toBe('#FFFFFF');
  });

  it('falls back to near-black ink for an invalid hex input', () => {
    expect(accessibleInkColor('not-a-colour')).toBe('#111827');
  });

  it('meets the WCAG AA threshold for every accessibleInkColor decision', () => {
    const backgrounds = ['#FCA5A5', '#FDBA74', '#FCD34D', '#FEF08A', '#86EFAC', '#5EEAD4',
      '#7DD3FC', '#93C5FD', '#A5B4FC', '#C4B5FD', '#F9A8D4', '#CBD5E1', '#111827', '#FFFFFF'];
    for (const bg of backgrounds) {
      const ink = accessibleInkColor(bg);
      expect(contrastRatio(bg, ink)).toBeGreaterThanOrEqual(WCAG_AA_TEXT_CONTRAST_RATIO);
    }
  });

  it('keeps the preferred colour when it already meets the AA threshold', () => {
    // #1f2937 (TEXT_DEFAULT_COLOR) against a light yellow background comfortably exceeds 4.5:1.
    expect(accessibleTextColorFor('#FFEB3B', '#1f2937')).toBe('#1f2937');
  });

  it('overrides the preferred colour when it fails the AA threshold', () => {
    // #1f2937 against a near-black background is dark-on-dark — falls back to white ink.
    expect(accessibleTextColorFor('#111827', '#1f2937')).toBe('#FFFFFF');
  });

  it('returns the preferred colour unchanged for an invalid background hex', () => {
    expect(accessibleTextColorFor('nonsense', '#1f2937')).toBe('#1f2937');
  });
});
