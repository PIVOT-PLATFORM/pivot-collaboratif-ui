/**
 * Rich-text formatting encode/decode for TEXT and LABEL cards, and plain-text
 * extraction helpers. Ported from the PouetPouet reference (`lib/card-format.ts`).
 *
 * A TEXT/LABEL card stores either raw text (unformatted, kept human-readable for
 * search/export) or a JSON formatting object once a non-default style is applied.
 */

/** Rich-text formatting for a LABEL card. */
export interface LabelFmt {
  text: string;
  size: number;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  color: string;
}

const LABEL_DEFAULTS: LabelFmt = {
  text: '',
  size: 16,
  bold: false,
  italic: false,
  underline: false,
  strike: false,
  color: '#374151',
};

/** Parses a label's stored content, falling back to plain text. */
export function parseLabelFmt(raw: string): LabelFmt {
  try {
    const p = JSON.parse(raw);
    if (p && typeof p === 'object' && 'text' in p) {
      return { ...LABEL_DEFAULTS, ...p };
    }
  } catch {
    /* not JSON — treat as plain text */
  }
  return { ...LABEL_DEFAULTS, text: raw };
}

/** Serializes a label's formatting (plain text when unstyled, JSON otherwise). */
export function serializeLabelFmt(fmt: LabelFmt): string {
  const { text, size, bold, italic, underline, strike, color } = fmt;
  const isDefault =
    size === LABEL_DEFAULTS.size &&
    !bold &&
    !italic &&
    !underline &&
    !strike &&
    color === LABEL_DEFAULTS.color;
  return isDefault ? text : JSON.stringify(fmt);
}

export type TextAlign = 'left' | 'center' | 'right';

/** Rich-text formatting for a TEXT card. */
export interface TextFmt {
  text: string;
  size: number;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  color: string;
  align: TextAlign;
}

const TEXT_DEFAULTS: TextFmt = {
  text: '',
  size: 14,
  bold: false,
  italic: false,
  underline: false,
  strike: false,
  color: '#1f2937',
  align: 'left',
};

/** Parses a TEXT card's stored content, falling back to plain text. */
export function parseTextFmt(raw: string): TextFmt {
  try {
    const p = JSON.parse(raw);
    if (p && typeof p === 'object' && 'text' in p) {
      return { ...TEXT_DEFAULTS, ...p };
    }
  } catch {
    /* not JSON — treat as plain text */
  }
  return { ...TEXT_DEFAULTS, text: raw };
}

/** Serializes a TEXT card's formatting (plain text when unstyled, JSON otherwise). */
export function serializeTextFmt(fmt: TextFmt): string {
  const { text, size, bold, italic, underline, strike, color, align } = fmt;
  const isDefault =
    size === TEXT_DEFAULTS.size &&
    !bold &&
    !italic &&
    !underline &&
    !strike &&
    color === TEXT_DEFAULTS.color &&
    align === TEXT_DEFAULTS.align;
  return isDefault ? text : JSON.stringify(fmt);
}

/** Extracts the plain, human-readable text of any card (unwraps TEXT/LABEL JSON). */
export function cardDisplayText(card: { type: string; content: string }): string {
  if (card.type === 'TEXT') {
    return parseTextFmt(card.content).text;
  }
  if (card.type === 'LABEL') {
    return parseLabelFmt(card.content).text;
  }
  return card.content;
}

/** Renders a field value for display; DATE values are localized (fr-FR). */
export function formatFieldValue(type: string, value: string): string {
  if (type === 'DATE' && value) {
    const d = new Date(value);
    return isNaN(d.getTime())
      ? value
      : d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit' });
  }
  return value;
}
