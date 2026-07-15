import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  IMAGE_MAX_H,
  IMAGE_MAX_W,
  computeImageCardSize,
  isEditableTarget,
  isImageClipboardItem,
  loadNaturalSize,
  looksLikeImageFilename,
  readAsDataUrl,
} from './image-card';

describe('computeImageCardSize', () => {
  it('clamps an upscale to a factor of 1 (image smaller than the max box stays native size)', () => {
    expect(computeImageCardSize(100, 80)).toEqual({ width: 100, height: 80 });
  });

  it('reduces on width when the width overflow dominates', () => {
    // naturalW=1400 -> 700/1400=0.5 ; naturalH=600 -> 600/600=1 ; min(0.5,1,1)=0.5
    expect(computeImageCardSize(1400, 600)).toEqual({ width: 700, height: 300 });
  });

  it('reduces on height when the height overflow dominates', () => {
    // naturalW=700 -> 700/700=1 ; naturalH=1200 -> 600/1200=0.5 ; min(1,0.5,1)=0.5
    expect(computeImageCardSize(700, 1200)).toEqual({ width: 350, height: 600 });
  });

  it('an already-≤700×600 image is never upscaled (factor exactly 1)', () => {
    expect(computeImageCardSize(700, 600)).toEqual({ width: 700, height: 600 });
  });

  it('falls back to the max box for invalid (zero/negative) natural dimensions', () => {
    expect(computeImageCardSize(0, 0)).toEqual({ width: IMAGE_MAX_W, height: IMAGE_MAX_H });
    expect(computeImageCardSize(-10, 50)).toEqual({ width: IMAGE_MAX_W, height: IMAGE_MAX_H });
  });
});

describe('isImageClipboardItem', () => {
  it('accepts a file item whose declared type starts with image/', () => {
    expect(isImageClipboardItem({ kind: 'file', type: 'image/png' })).toBe(true);
    expect(isImageClipboardItem({ kind: 'file', type: 'IMAGE/JPEG' })).toBe(true);
  });

  it('rejects a non-file item or a non-image MIME type', () => {
    expect(isImageClipboardItem({ kind: 'string', type: 'image/png' })).toBe(false);
    expect(isImageClipboardItem({ kind: 'file', type: 'text/plain' })).toBe(false);
    expect(isImageClipboardItem({ kind: 'file', type: '' })).toBe(false);
  });
});

describe('looksLikeImageFilename', () => {
  it('recognises the five extensions, case-insensitively', () => {
    for (const name of ['photo.png', 'photo.JPG', 'photo.jpeg', 'photo.gif', 'photo.WEBP', 'photo.bmp']) {
      expect(looksLikeImageFilename(name)).toBe(true);
    }
  });

  it('rejects an unrelated extension or a missing filename', () => {
    expect(looksLikeImageFilename('document.pdf')).toBe(false);
    expect(looksLikeImageFilename('archive.svg')).toBe(false);
    expect(looksLikeImageFilename(null)).toBe(false);
    expect(looksLikeImageFilename(undefined)).toBe(false);
  });
});

describe('isEditableTarget', () => {
  it('treats INPUT/TEXTAREA and contenteditable elements as editable', () => {
    expect(isEditableTarget(document.createElement('input'))).toBe(true);
    expect(isEditableTarget(document.createElement('textarea'))).toBe(true);
    const div = document.createElement('div');
    Object.defineProperty(div, 'isContentEditable', { value: true });
    expect(isEditableTarget(div)).toBe(true);
  });

  it('treats a plain element or null as not editable', () => {
    expect(isEditableTarget(document.createElement('div'))).toBe(false);
    expect(isEditableTarget(null)).toBe(false);
  });
});

describe('readAsDataUrl', () => {
  it('resolves with the data URL produced by FileReader', async () => {
    const file = new Blob(['hello'], { type: 'text/plain' });
    const result = await readAsDataUrl(file);
    expect(result).toMatch(/^data:/);
  });
});

describe('loadNaturalSize', () => {
  const originalImage = globalThis.Image;

  class FakeImage {
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    naturalWidth = 0;
    naturalHeight = 0;
    private _src = '';
    set src(value: string) {
      this._src = value;
      if (value === 'bad') {
        queueMicrotask(() => this.onerror?.());
      } else {
        this.naturalWidth = 42;
        this.naturalHeight = 24;
        queueMicrotask(() => this.onload?.());
      }
    }
    get src(): string {
      return this._src;
    }
  }

  beforeEach(() => {
    (globalThis as unknown as { Image: unknown }).Image = FakeImage;
  });

  afterEach(() => {
    (globalThis as unknown as { Image: unknown }).Image = originalImage;
    vi.restoreAllMocks();
  });

  it('resolves the natural width/height once the image loads', async () => {
    await expect(loadNaturalSize('data:image/png;base64,abc')).resolves.toEqual({ naturalW: 42, naturalH: 24 });
  });

  it('rejects when the image fails to decode', async () => {
    await expect(loadNaturalSize('bad')).rejects.toThrow('Invalid image data');
  });
});
