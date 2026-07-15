/**
 * IMAGE card helpers (US08.6.4): dimensioning, clipboard/file-type detection, and the two
 * async DOM readers (FileReader / Image) used to turn a pasted or uploaded file into an
 * `IMAGE` card's `content` + `width`/`height`.
 *
 * Ported from the PouetPouet reference's insertion logic (parity spec §4.8/§7): a pasted or
 * uploaded image is downscaled (never upscaled) to fit within `IMAGE_MAX_W` x `IMAGE_MAX_H`,
 * preserving its aspect ratio.
 */

/** Maximum card width for an inserted image (parity spec §7). */
export const IMAGE_MAX_W = 700;
/** Maximum card height for an inserted image (parity spec §7). */
export const IMAGE_MAX_H = 600;

/** Filename fallback recognised when a pasted file carries no MIME type (parity spec §4.8). */
const IMAGE_EXTENSION_RE = /\.(png|jpe?g|gif|webp|bmp)$/i;

/**
 * Computes the card size for an image of natural dimensions `naturalW` x `naturalH`.
 *
 * The applied factor is exactly `min(700/naturalW, 600/naturalH, 1)` — never an upscale
 * (the `1` upper bound) — so the card always fits within {@link IMAGE_MAX_W} x
 * {@link IMAGE_MAX_H} while preserving the aspect ratio.
 */
export function computeImageCardSize(naturalW: number, naturalH: number): { width: number; height: number } {
  if (!(naturalW > 0) || !(naturalH > 0)) {
    return { width: IMAGE_MAX_W, height: IMAGE_MAX_H };
  }
  const factor = Math.min(IMAGE_MAX_W / naturalW, IMAGE_MAX_H / naturalH, 1);
  return { width: naturalW * factor, height: naturalH * factor };
}

/** A minimal, structurally-typed subset of `DataTransferItem` — kept narrow for testability. */
export interface ClipboardFileItemLike {
  kind: string;
  type: string;
}

/** Whether a clipboard/drop item is a file whose declared MIME type is an image. */
export function isImageClipboardItem(item: ClipboardFileItemLike): boolean {
  return item.kind === 'file' && item.type.toLowerCase().startsWith('image/');
}

/**
 * Filename-extension fallback (parity spec §4.8) for a pasted file with no MIME type at all
 * (e.g. copied from certain OS file explorers).
 */
export function looksLikeImageFilename(name: string | null | undefined): boolean {
  return !!name && IMAGE_EXTENSION_RE.test(name);
}

/**
 * Whether `element` is an editable target (a form control being typed into, or a
 * `contenteditable` region) — paste must be a no-op there (AC: "le focus est dans un champ
 * éditable ... rien ne se passe").
 */
export function isEditableTarget(element: Element | null): boolean {
  if (!element) {
    return false;
  }
  const tag = element.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA') {
    return true;
  }
  return (element as HTMLElement).isContentEditable === true;
}

/** Reads a `Blob`/`File` as a base64 data URL. */
export function readAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('FileReader failed'));
    reader.readAsDataURL(file);
  });
}

/** Resolves a data URL's natural (undecoded) pixel dimensions by loading it as an `Image`. */
export function loadNaturalSize(dataUrl: string): Promise<{ naturalW: number; naturalH: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ naturalW: img.naturalWidth, naturalH: img.naturalHeight });
    img.onerror = () => reject(new Error('Invalid image data'));
    img.src = dataUrl;
  });
}
