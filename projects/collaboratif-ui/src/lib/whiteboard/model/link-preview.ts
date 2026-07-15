import type { Card, OgMeta } from './board.types';

/**
 * Render-time sanitisation for a LINK card's URL and its OpenGraph preview (`meta`), US08.6.5.
 *
 * The backend already sanitises `meta` before broadcasting it (HTML-tag stripping, entity
 * decoding, `meta.image` scheme validation — see `pivot-collaboratif-core`'s
 * `OpenGraphFetcher`), but this repo's own security rule ("Contenu affiché : utiliser Angular
 * interpolation `{{ val }}` — jamais `innerHTML`") is a per-render-site rule, not a
 * trust-the-backend one — a second, independent validation here means a bug or a compromise of
 * that server-side sanitisation is not the only thing standing between an untrusted OG tag and
 * this UI's DOM. Every text field is still rendered via `{{ }}` interpolation (auto-escaping);
 * this module only decides *whether* a value is safe to bind at all (e.g. an `<img src>`, which
 * has no interpolation-level escaping to fall back on).
 */

/**
 * Returns whether `value` is a well-formed absolute `http`/`https` URL — the only schemes ever
 * safe to bind as an anchor `href` or an `<img src>` in this component (blocks `javascript:`,
 * `data:`, `vbscript:`, relative paths, and anything malformed).
 *
 * @param value the candidate URL, possibly `null`/`undefined`
 * @returns `true` if `value` is a parseable absolute URL with an `http`/`https` scheme
 */
export function isSafeHttpUrl(value: string | null | undefined): value is string {
  if (!value) {
    return false;
  }
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Returns the card's raw URL if (and only if) it is a safe `href` target — `card.content` for a
 * `LINK` card is expected to already be an `http(s)` URL (parity spec §3.4's detection regex),
 * but this is re-validated at render time rather than assumed, so a corrupted/forged `content`
 * can never end up as a `javascript:`/`data:` anchor target.
 *
 * @param card the LINK card
 * @returns the safe URL to use as `href`, or `null` if `card.content` is not one
 */
export function safeLinkHref(card: Card): string | null {
  return isSafeHttpUrl(card.content) ? card.content : null;
}

/**
 * Returns the card's OpenGraph preview image URL, or `null` if absent or not a safe absolute
 * `http`/`https` URL — never binds an unsafe value as an `<img src>`.
 *
 * @param meta the card's OpenGraph metadata, or `null`/`undefined` if not yet enriched
 * @returns the safe image URL, or `null`
 */
export function safeLinkImage(meta: OgMeta | null | undefined): string | null {
  const image = meta?.image;
  return isSafeHttpUrl(image) ? image : null;
}

/**
 * Returns the best available human-readable label for a LINK card: the OG title if present,
 * otherwise the raw URL — used for both the visible fallback text and the `aria-label` (parity
 * spec A11y AC: `aria-label` = OG title or URL).
 *
 * @param card the LINK card
 * @param meta the card's OpenGraph metadata, or `null`/`undefined` if not yet enriched
 * @returns the title or URL, whichever is available
 */
export function linkDisplayLabel(card: Card, meta: OgMeta | null | undefined): string {
  return meta?.title?.trim() || card.content;
}

/**
 * Detects whether `text`, once trimmed, is a URL <strong>and nothing else</strong> — the
 * "texte reconnu comme URL" trigger for creating a LINK card straight from a clipboard paste
 * (parity spec §3.4/§1.5). Deliberately anchored to the whole string (unlike the backend's
 * `CardUrlExtractor`, which searches for a URL substring anywhere in a TEXT/LABEL card's
 * content) — pasting a sentence that merely contains a URL must still land as a plain TEXT
 * card, not silently get reinterpreted as a LINK card.
 *
 * @param text the raw clipboard text
 * @returns `true` if the trimmed text is exactly one `http`/`https` URL
 */
export function isUrlOnlyPaste(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed || /\s/.test(trimmed)) {
    return false;
  }
  return isSafeHttpUrl(trimmed);
}
