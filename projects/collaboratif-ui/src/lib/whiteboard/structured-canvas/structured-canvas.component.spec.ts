import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter, Router } from '@angular/router';
import { TranslocoTestingModule } from '@jsverse/transloco';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StructuredCanvasComponent } from './structured-canvas.component';
import { BoardStore } from '../../core/whiteboard/board.store';
import { BoardTransport } from '../../core/whiteboard/board-transport';
import { COLLABORATIF_API_URL } from '../../core/whiteboard/config/tokens';

/** Inert transport — this suite never opens the realtime room (`store.init` is never called). */
class NoopTransport extends BoardTransport {
  connect(): void {}
  disconnect(): void {}
  emit(): void {}
  on<T = unknown>(_type: string, _handler: (data: T) => void): () => void {
    return () => {};
  }
  onReconnect(_handler: () => void): () => void {
    return () => {};
  }
  getSessionId(): string {
    return 'noop-transport-session';
  }
}

const FR_TRANSLATIONS = {
  whiteboard: {
    canvas: { ariaLabel: 'Canevas du tableau blanc' },
  },
};

/** Builds a synthetic `paste` event carrying `text` as `text/plain` clipboard data — jsdom's
 *  `ClipboardEvent` does not reliably support `clipboardData` via its constructor options, so
 *  the property is defined directly on a plain `Event` instead (works in every DOM environment). */
function pasteEventWith(text: string): Event {
  const event = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', {
    value: { getData: () => text },
  });
  return event;
}

describe('StructuredCanvasComponent — URL paste creates a LINK card (US08.6.5)', () => {
  let fixture: ComponentFixture<StructuredCanvasComponent>;
  let store: BoardStore;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [
        StructuredCanvasComponent,
        TranslocoTestingModule.forRoot({
          langs: { fr: FR_TRANSLATIONS },
          translocoConfig: { defaultLang: 'fr', availableLangs: ['fr'] },
          preloadLangs: true,
        }),
      ],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: COLLABORATIF_API_URL, useValue: 'http://localhost:8083/api/collaboratif' },
        BoardStore,
        { provide: BoardTransport, useClass: NoopTransport },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(StructuredCanvasComponent);
    // `store.init()` is never called — this suite only exercises the paste listener, not the
    // realtime lifecycle, so no HTTP/websocket setup needs flushing.
    store = fixture.debugElement.injector.get(BoardStore);
    fixture.detectChanges();
  });

  afterEach(() => {
    fixture.destroy();
    document.body.querySelectorAll('input.test-focus-target').forEach((el) => el.remove());
  });

  it('creates a LINK card when a URL-only paste happens with no editable element focused', () => {
    const addCard = vi.spyOn(store, 'addCard');
    document.dispatchEvent(pasteEventWith('https://example.com/article'));

    expect(addCard).toHaveBeenCalledTimes(1);
    const [, , type, content] = addCard.mock.calls[0];
    expect(type).toBe('LINK');
    expect(content).toBe('https://example.com/article');
  });

  it('trims surrounding whitespace from the pasted URL', () => {
    const addCard = vi.spyOn(store, 'addCard');
    document.dispatchEvent(pasteEventWith('  https://example.com/x  '));

    expect(addCard).toHaveBeenCalledTimes(1);
    expect(addCard.mock.calls[0][3]).toBe('https://example.com/x');
  });

  it('falls back to a TEXT card when the pasted text is not a URL by itself (US08.6.4 error-case AC)', () => {
    const addCard = vi.spyOn(store, 'addCard');
    document.dispatchEvent(pasteEventWith('just some plain text'));

    expect(addCard).toHaveBeenCalledTimes(1);
    const [, , type, content] = addCard.mock.calls[0];
    expect(type).toBe('TEXT');
    expect(content).toBe('just some plain text');
  });

  it('a URL embedded in a longer text still falls back to TEXT, not LINK (URL must be the whole paste)', () => {
    const addCard = vi.spyOn(store, 'addCard');
    document.dispatchEvent(pasteEventWith('check this out: https://example.com'));

    expect(addCard).toHaveBeenCalledTimes(1);
    expect(addCard.mock.calls[0][2]).toBe('TEXT');
  });

  it('does not hijack a paste while an editable input has focus', () => {
    const input = document.createElement('input');
    input.className = 'test-focus-target';
    document.body.appendChild(input);
    input.focus();

    const addCard = vi.spyOn(store, 'addCard');
    document.dispatchEvent(pasteEventWith('https://example.com/article'));

    expect(addCard).not.toHaveBeenCalled();
  });

  it('does not create a card in read-only mode', () => {
    vi.spyOn(store, 'isReadonly').mockReturnValue(true);
    const addCard = vi.spyOn(store, 'addCard');
    document.dispatchEvent(pasteEventWith('https://example.com/article'));

    expect(addCard).not.toHaveBeenCalled();
  });
});

/**
 * US08.6.2 — the 'text' placement tool must create a LABEL card (a compact, persistent text
 * label), not a TEXT (post-it) card. 'sticky' keeps creating TEXT — a regression guard so a
 * future edit to this dispatch does not silently collapse the two tools back together.
 *
 * Scoped to `createCard`/`placementKind` only: the rest of `StructuredCanvasComponent`'s
 * pointer state machine (drag/resize/connect/marquee) is pre-existing, untouched by this US,
 * and out of scope here.
 */
describe('StructuredCanvasComponent — LABEL placement tool (US08.6.2)', () => {
  let component: StructuredCanvasComponent;
  let addCard: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    addCard = vi.fn();
    await TestBed.configureTestingModule({
      imports: [
        StructuredCanvasComponent,
        TranslocoTestingModule.forRoot({
          langs: { fr: {}, en: {} },
          translocoConfig: { defaultLang: 'fr', availableLangs: ['fr', 'en'] },
          preloadLangs: true,
        }),
      ],
      providers: [{ provide: BoardStore, useValue: { addCard } }],
    }).compileComponents();

    component = TestBed.createComponent(StructuredCanvasComponent).componentInstance;
  });

  it('placementKind resolves the "text" tool to a card-placement gesture', () => {
    expect(component['placementKind']('text')).toBe('text');
  });

  it('the "text" tool creates a LABEL card with empty content', () => {
    component['createCard']('text', 100, 50);
    expect(addCard).toHaveBeenCalledTimes(1);
    const [, , type, content] = addCard.mock.calls[0];
    expect(type).toBe('LABEL');
    expect(content).toBe('');
  });

  it('the "sticky" tool still creates a TEXT card — LABEL and TEXT stay distinct', () => {
    component['createCard']('sticky', 100, 50);
    expect(addCard).toHaveBeenCalledTimes(1);
    const [, , type] = addCard.mock.calls[0];
    expect(type).toBe('TEXT');
  });
});

/** Protected surface exercised by this suite (same pattern as `board-page.component.spec.ts`). */
interface CanvasApi {
  insertImageFile(file: File): Promise<void>;
  onPaste(event: ClipboardEvent): Promise<void>;
}

/** Records every `emit()` call — this suite only cares about what is sent over the wire. */
class RecordingTransport extends BoardTransport {
  readonly emitted: Array<{ type: string; data: unknown }> = [];
  connect(): void {}
  disconnect(): void {}
  emit(type: string, data?: unknown): void {
    this.emitted.push({ type, data });
  }
  on<T = unknown>(_type: string, _handler: (data: T) => void): () => void {
    return () => {};
  }
  onReconnect(_handler: () => void): () => void {
    return () => {};
  }
}

/** A minimal fake `Image` — jsdom never actually decodes pixels, so `onload` never fires on
 *  a real `Image`. Mirrors the technique used in `image-card.spec.ts`. */
class FakeImage {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  naturalWidth = 0;
  naturalHeight = 0;
  private _src = '';
  set src(value: string) {
    this._src = value;
    this.naturalWidth = 1400;
    this.naturalHeight = 600;
    queueMicrotask(() => this.onload?.());
  }
  get src(): string {
    return this._src;
  }
}

describe('StructuredCanvasComponent — image insertion (US08.6.4)', () => {
  const originalImage = globalThis.Image;
  let transport: RecordingTransport;

  async function create() {
    transport = new RecordingTransport();
    await TestBed.configureTestingModule({
      imports: [
        StructuredCanvasComponent,
        TranslocoTestingModule.forRoot({
          langs: { fr: FR_TRANSLATIONS },
          translocoConfig: { defaultLang: 'fr', availableLangs: ['fr'] },
          preloadLangs: true,
        }),
      ],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: Router, useValue: { navigateByUrl: vi.fn() } },
        { provide: COLLABORATIF_API_URL, useValue: 'http://localhost:8083/api/collaboratif' },
        BoardStore,
        { provide: BoardTransport, useValue: transport },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(StructuredCanvasComponent);
    fixture.detectChanges();
    const store = fixture.debugElement.injector.get(BoardStore);
    const api = fixture.componentInstance as unknown as CanvasApi;
    return { fixture, store, api };
  }

  beforeEach(() => {
    (globalThis as unknown as { Image: unknown }).Image = FakeImage;
  });

  afterEach(() => {
    (globalThis as unknown as { Image: unknown }).Image = originalImage;
    vi.restoreAllMocks();
  });

  it('explicit upload creates a dimensioned IMAGE card (naturalW=1400,naturalH=600 -> 700x300)', async () => {
    const { api } = await create();
    const file = new File(['fake-bytes'], 'photo.png', { type: 'image/png' });

    await api.insertImageFile(file);

    expect(transport.emitted).toHaveLength(1);
    const [{ type, data }] = transport.emitted;
    expect(type).toBe('card:create');
    const payload = data as Record<string, unknown>;
    expect(payload['type']).toBe('IMAGE');
    expect(payload['width']).toBe(700);
    expect(payload['height']).toBe(300);
    expect(String(payload['content'])).toMatch(/^data:/);
  });

  it('does not insert while the board is read-only (VIEWER)', async () => {
    const { store, api } = await create();
    store.userRole.set('VIEWER');
    const file = new File(['fake-bytes'], 'photo.png', { type: 'image/png' });

    await api.insertImageFile(file);

    expect(transport.emitted).toHaveLength(0);
  });

  it('pasting an image file creates an IMAGE card', async () => {
    const { api } = await create();
    const file = new File(['fake-bytes'], 'photo.png', { type: 'image/png' });
    const event = new Event('paste', { cancelable: true }) as ClipboardEvent;
    Object.defineProperty(event, 'clipboardData', {
      value: { items: [{ kind: 'file', type: 'image/png', getAsFile: () => file }], getData: () => '' },
    });

    await api.onPaste(event);

    expect(transport.emitted).toHaveLength(1);
    expect((transport.emitted[0].data as Record<string, unknown>)['type']).toBe('IMAGE');
  });

  it('pasting while focus is in an editable field is a no-op', async () => {
    const { api } = await create();
    const textarea = document.createElement('textarea');
    document.body.appendChild(textarea);
    textarea.focus();
    try {
      const file = new File(['fake-bytes'], 'photo.png', { type: 'image/png' });
      const event = new Event('paste', { cancelable: true }) as ClipboardEvent;
      Object.defineProperty(event, 'clipboardData', {
        value: { items: [{ kind: 'file', type: 'image/png', getAsFile: () => file }], getData: () => '' },
      });

      await api.onPaste(event);

      expect(transport.emitted).toHaveLength(0);
    } finally {
      textarea.remove();
    }
  });

  it('pasting a non-image file falls back to a trimmed TEXT card (error-case AC)', async () => {
    const { api } = await create();
    const event = new Event('paste', { cancelable: true }) as ClipboardEvent;
    Object.defineProperty(event, 'clipboardData', {
      value: {
        items: [{ kind: 'file', type: 'application/pdf', getAsFile: () => new File(['x'], 'doc.pdf') }],
        getData: (fmt: string) => (fmt === 'text/plain' ? '  hello board  ' : ''),
      },
    });

    await api.onPaste(event);

    expect(transport.emitted).toHaveLength(1);
    const [{ type, data }] = transport.emitted;
    expect(type).toBe('card:create');
    const payload = data as Record<string, unknown>;
    expect(payload['type']).toBe('TEXT');
    expect(payload['content']).toBe('hello board');
  });

  it('pasting a file with no MIME type falls back to the filename extension (repli)', async () => {
    const { api } = await create();
    const file = new File(['fake-bytes'], 'scan.jpeg', { type: '' });
    const event = new Event('paste', { cancelable: true }) as ClipboardEvent;
    Object.defineProperty(event, 'clipboardData', {
      value: { items: [{ kind: 'file', type: '', getAsFile: () => file }], getData: () => '' },
    });

    await api.onPaste(event);

    expect(transport.emitted).toHaveLength(1);
    expect((transport.emitted[0].data as Record<string, unknown>)['type']).toBe('IMAGE');
  });
});
