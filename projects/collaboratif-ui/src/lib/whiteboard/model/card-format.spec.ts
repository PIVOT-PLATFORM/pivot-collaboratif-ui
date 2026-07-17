import { describe, expect, it } from 'vitest';
import { parseLabelFmt, parseTextFmt, serializeLabelFmt, serializeTextFmt } from './card-format';

/**
 * TEXT/LABEL formatting codec. A card stores raw text while unstyled — kept human-readable for
 * search and export — and switches to JSON once any non-default style is applied. That switch is
 * the delicate part: a style left out of the "is it default?" test is silently dropped.
 */
describe('card-format codec', () => {
  describe('LABEL', () => {
    it('reads plain text as an unstyled label', () => {
      const fmt = parseLabelFmt('Étiquette');

      expect(fmt.text).toBe('Étiquette');
      expect(fmt.align).toBe('left');
      expect(fmt.bold).toBe(false);
    });

    it('keeps an unstyled label as plain text, not JSON', () => {
      expect(serializeLabelFmt(parseLabelFmt('Étiquette'))).toBe('Étiquette');
    });

    /**
     * The regression this guards: `align` was added to the model but not to the default test, so a
     * centred label serialised back to plain text and lost its alignment on the next read.
     */
    it('stores an aligned label as JSON, so the alignment survives a round-trip', () => {
      const centred = { ...parseLabelFmt('Étiquette'), align: 'center' as const };

      const raw = serializeLabelFmt(centred);
      expect(raw).not.toBe('Étiquette');
      expect(parseLabelFmt(raw).align).toBe('center');
      expect(parseLabelFmt(raw).text).toBe('Étiquette');
    });

    it('round-trips every alignment', () => {
      for (const align of ['left', 'center', 'right'] as const) {
        const fmt = { ...parseLabelFmt('x'), align };
        expect(parseLabelFmt(serializeLabelFmt(fmt)).align).toBe(align);
      }
    });

    /** A label written before `align` existed has no such field — it must not read as `undefined`. */
    it('defaults the alignment of a label stored before the field existed', () => {
      const legacy = JSON.stringify({ text: 'Ancien', size: 16, bold: true, italic: false, underline: false, strike: false, color: '#374151' });

      expect(parseLabelFmt(legacy).align).toBe('left');
      expect(parseLabelFmt(legacy).bold).toBe(true);
    });

    it('falls back to plain text for malformed JSON', () => {
      expect(parseLabelFmt('{ not json').text).toBe('{ not json');
    });
  });

  describe('TEXT', () => {
    it('round-trips an alignment', () => {
      const fmt = { ...parseTextFmt('Note'), align: 'right' as const };

      expect(parseTextFmt(serializeTextFmt(fmt)).align).toBe('right');
    });

    it('keeps an unstyled text card as plain text', () => {
      expect(serializeTextFmt(parseTextFmt('Note'))).toBe('Note');
    });
  });
});
