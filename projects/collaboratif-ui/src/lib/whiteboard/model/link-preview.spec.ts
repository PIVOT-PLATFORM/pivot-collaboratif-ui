import { describe, expect, it } from 'vitest';
import type { Card, OgMeta } from './board.types';
import { isSafeHttpUrl, isUrlOnlyPaste, linkDisplayLabel, safeLinkHref, safeLinkImage } from './link-preview';

function makeCard(overrides: Partial<Card> = {}): Card {
  return {
    id: 'c1',
    boardId: 'b1',
    type: 'LINK',
    content: 'https://example.com',
    meta: null,
    posX: 0,
    posY: 0,
    width: 280,
    height: 170,
    color: '#ffffff',
    groupId: null,
    groupColor: null,
    locked: false,
    layer: 1,
    fieldValues: [],
    ...overrides,
  };
}

describe('isSafeHttpUrl', () => {
  it('accepts http and https URLs', () => {
    expect(isSafeHttpUrl('https://example.com/article')).toBe(true);
    expect(isSafeHttpUrl('http://example.com')).toBe(true);
  });

  it('rejects non-http(s) schemes', () => {
    expect(isSafeHttpUrl('javascript:alert(1)')).toBe(false);
    expect(isSafeHttpUrl('data:text/html,<script>alert(1)</script>')).toBe(false);
    expect(isSafeHttpUrl('file:///etc/passwd')).toBe(false);
  });

  it('rejects malformed or relative values', () => {
    expect(isSafeHttpUrl('/relative/path')).toBe(false);
    expect(isSafeHttpUrl('not a url')).toBe(false);
    expect(isSafeHttpUrl(null)).toBe(false);
    expect(isSafeHttpUrl(undefined)).toBe(false);
    expect(isSafeHttpUrl('')).toBe(false);
  });
});

describe('safeLinkHref', () => {
  it('returns the content when it is a safe URL', () => {
    const card = makeCard({ content: 'https://example.com/page' });
    expect(safeLinkHref(card)).toBe('https://example.com/page');
  });

  it('returns null when content is not a safe URL (defence in depth)', () => {
    const card = makeCard({ content: 'javascript:alert(1)' });
    expect(safeLinkHref(card)).toBeNull();
  });
});

describe('safeLinkImage', () => {
  it('returns the image URL when well-formed http(s)', () => {
    const meta: OgMeta = { image: 'https://cdn.example.com/a.png' };
    expect(safeLinkImage(meta)).toBe('https://cdn.example.com/a.png');
  });

  it('returns null for a javascript: image URL even if the backend somehow sent one', () => {
    const meta: OgMeta = { image: 'javascript:alert(1)' };
    expect(safeLinkImage(meta)).toBeNull();
  });

  it('returns null when meta or image is absent', () => {
    expect(safeLinkImage(null)).toBeNull();
    expect(safeLinkImage(undefined)).toBeNull();
    expect(safeLinkImage({})).toBeNull();
  });
});

describe('linkDisplayLabel', () => {
  it('prefers the OG title when present', () => {
    const card = makeCard({ content: 'https://example.com' });
    expect(linkDisplayLabel(card, { title: 'Example Article' })).toBe('Example Article');
  });

  it('falls back to the raw URL when no title (raw-URL state, A11y AC)', () => {
    const card = makeCard({ content: 'https://example.com' });
    expect(linkDisplayLabel(card, null)).toBe('https://example.com');
    expect(linkDisplayLabel(card, { title: '' })).toBe('https://example.com');
    expect(linkDisplayLabel(card, { title: '   ' })).toBe('https://example.com');
  });
});

describe('isUrlOnlyPaste', () => {
  it('recognises a bare URL as URL-only', () => {
    expect(isUrlOnlyPaste('https://example.com/article')).toBe(true);
    expect(isUrlOnlyPaste('  https://example.com  ')).toBe(true);
  });

  it('rejects text that merely contains a URL among other words', () => {
    expect(isUrlOnlyPaste('check this out: https://example.com')).toBe(false);
    expect(isUrlOnlyPaste('https://example.com is great')).toBe(false);
  });

  it('rejects blank text and non-URL text', () => {
    expect(isUrlOnlyPaste('')).toBe(false);
    expect(isUrlOnlyPaste('   ')).toBe(false);
    expect(isUrlOnlyPaste('just some text')).toBe(false);
  });

  it('rejects a non-http(s) scheme even if it is the whole pasted text', () => {
    expect(isUrlOnlyPaste('javascript:alert(1)')).toBe(false);
  });
});
