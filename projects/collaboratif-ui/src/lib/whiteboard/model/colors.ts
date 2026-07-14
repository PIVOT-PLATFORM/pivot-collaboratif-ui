/**
 * Single source of truth for the colours offered across the whiteboard (cards,
 * shapes, labels, groups). Ported from the PouetPouet reference (`lib/colors.ts`).
 * Quick-pick swatches use {@link BASE_COLORS}; anything beyond is available via the
 * custom picker, and recent custom colours are remembered in `localStorage`.
 */

/** Softened pastel palette (≈ Tailwind 300 level) plus neutrals for text. */
export const BASE_COLORS = [
  '#FCA5A5', // red
  '#FDBA74', // orange
  '#FCD34D', // amber
  '#FEF08A', // yellow
  '#86EFAC', // green
  '#5EEAD4', // teal
  '#7DD3FC', // sky
  '#93C5FD', // blue
  '#A5B4FC', // indigo
  '#C4B5FD', // violet
  '#F9A8D4', // pink
  '#CBD5E1', // soft gray
  '#111827', // near-black
  '#FFFFFF', // white
] as const;

/** Default sticky-note colour (soft yellow). */
export const DEFAULT_CARD_COLOR = '#FEF08A';
/** Default shape / drawing colour (soft indigo). */
export const DEFAULT_SHAPE_COLOR = '#A5B4FC';
/** Default label text colour (near-black). */
export const DEFAULT_LABEL_COLOR = '#111827';

/** Group ring colours drawn from the pastel palette. */
export const GROUP_COLORS = [
  '#FCA5A5',
  '#FDBA74',
  '#86EFAC',
  '#7DD3FC',
  '#93C5FD',
  '#C4B5FD',
  '#F9A8D4',
] as const;

const RECENTS_KEY = 'pp-recent-colors';
const RECENTS_MAX = 8;

/** Strict 3/6-digit hex validation — guards against CSS injection. */
export function isHexColor(c: string): boolean {
  return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(c);
}

function hexToRgb(hex: string): [number, number, number] {
  let h = hex.replace('#', '');
  if (h.length === 3) {
    h = h
      .split('')
      .map((c) => c + c)
      .join('');
  }
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHex(r: number, g: number, b: number): string {
  const to = (v: number): string =>
    Math.round(Math.max(0, Math.min(255, v)))
      .toString(16)
      .padStart(2, '0');
  return `#${to(r)}${to(g)}${to(b)}`;
}

/**
 * Derives a richer header-band shade of a card colour: light/pastel colours are
 * darkened, already-dark colours are lightened, so the header stays distinct.
 */
export function headerTint(hex: string): string {
  if (!isHexColor(hex)) {
    return hex;
  }
  const [r, g, b] = hexToRgb(hex);
  const lum = 0.299 * r + 0.587 * g + 0.114 * b;
  if (lum < 70) {
    return rgbToHex(r + (255 - r) * 0.05, g + (255 - g) * 0.05, b + (255 - b) * 0.05);
  }
  return rgbToHex(r * 0.95, g * 0.95, b * 0.95);
}

function srgbToLinear(channel: number): number {
  const v = channel / 255;
  return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

/** WCAG relative luminance of a hex colour (0 = black, 1 = white). */
export function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex);
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
}

/** WCAG contrast ratio between two hex colours (1:1 to 21:1). */
export function contrastRatio(hexA: string, hexB: string): number {
  const lA = relativeLuminance(hexA);
  const lB = relativeLuminance(hexB);
  const lighter = Math.max(lA, lB);
  const darker = Math.min(lA, lB);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Picks black or white ink — whichever yields the higher WCAG contrast ratio against
 * `backgroundHex` — so a sticky note's text/background contrast never depends on which
 * background swatch a user happens to pick (US08.6.1 A11y AC: ratio ≥ 4.5:1, WCAG 2.1 AA,
 * regardless of the chosen background colour).
 */
export function accessibleInkColor(backgroundHex: string): string {
  if (!isHexColor(backgroundHex)) {
    return DEFAULT_LABEL_COLOR;
  }
  const white = '#FFFFFF';
  return contrastRatio(backgroundHex, DEFAULT_LABEL_COLOR) >= contrastRatio(backgroundHex, white)
    ? DEFAULT_LABEL_COLOR
    : white;
}

/** Minimum WCAG 2.1 AA contrast ratio for normal-size text (US08.6.1 A11y AC). */
export const WCAG_AA_TEXT_CONTRAST_RATIO = 4.5;

/**
 * Keeps `preferredHex` (typically a card type's *default*, unstyled ink colour) as long as it
 * meets {@link WCAG_AA_TEXT_CONTRAST_RATIO} against `backgroundHex`; falls back to
 * {@link accessibleInkColor} only when it does not (e.g. the default dark-gray TEXT ink against
 * a near-black background swatch). A colour a user explicitly customised away from the default
 * is never passed through this function — see call sites.
 */
export function accessibleTextColorFor(backgroundHex: string, preferredHex: string): string {
  if (!isHexColor(backgroundHex) || !isHexColor(preferredHex)) {
    return preferredHex;
  }
  return contrastRatio(backgroundHex, preferredHex) >= WCAG_AA_TEXT_CONTRAST_RATIO
    ? preferredHex
    : accessibleInkColor(backgroundHex);
}

/** Deterministic group ring colour derived from the group id. */
export function groupColor(groupId: string): string {
  let hash = 0;
  for (let i = 0; i < groupId.length; i++) {
    hash = (hash * 31 + groupId.charCodeAt(i)) >>> 0;
  }
  return GROUP_COLORS[hash % GROUP_COLORS.length];
}

/** Reads the recent custom colours from `localStorage` (browser only). */
export function getRecentColors(): string[] {
  if (typeof localStorage === 'undefined') {
    return [];
  }
  try {
    const raw = JSON.parse(localStorage.getItem(RECENTS_KEY) || '[]');
    return Array.isArray(raw)
      ? raw.filter((c) => typeof c === 'string' && isHexColor(c)).slice(0, RECENTS_MAX)
      : [];
  } catch {
    return [];
  }
}

/** Records a custom colour (skipping base-palette entries). Returns the new list. */
export function pushRecentColor(color: string): string[] {
  if (typeof localStorage === 'undefined' || !isHexColor(color)) {
    return [];
  }
  const norm = color.toLowerCase();
  if ((BASE_COLORS as readonly string[]).map((c) => c.toLowerCase()).includes(norm)) {
    return getRecentColors();
  }
  const next = [norm, ...getRecentColors().filter((c) => c.toLowerCase() !== norm)].slice(
    0,
    RECENTS_MAX,
  );
  try {
    localStorage.setItem(RECENTS_KEY, JSON.stringify(next));
  } catch {
    /* quota / disabled storage — non-fatal */
  }
  return next;
}
