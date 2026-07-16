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
import type { Card } from '../model/board.types';

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
    // `items` is always present (though possibly empty) on a real browser DataTransfer —
    // the merged onPaste handler checks for a pasted image file first (US08.6.4) before
    // falling back to text (US08.6.5/US08.6.4), so the mock needs to look like a real one.
    value: { getData: () => text, items: [] },
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

/**
 * Frame placement tool — the toolbar gap this US fills. The frame model/rendering already
 * existed (`BoardStore.addFrame`, `frame-item`); only the UI entry point (toolbar button +
 * canvas placement) was missing. Mirrors the existing `createCard` flow: a click on the empty
 * canvas while `tool() === 'frame'` calls `store.addFrame` with the click point (the frame's
 * top-left corner — the server assigns a default width/height on `frame:create`, unlike cards
 * whose client-known W×H lets `createCard` centre them on the click point) and emits
 * `toolConsumed` to fall back to `select`.
 */
describe('StructuredCanvasComponent — frame placement tool', () => {
  let fixture: ComponentFixture<StructuredCanvasComponent>;
  let component: StructuredCanvasComponent;
  let addFrame: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    addFrame = vi.fn();
    const storeStub = {
      addFrame,
      isReadonly: () => false,
      frames: () => [],
      cards: () => [],
      connections: () => [],
      selectedIds: () => new Set<string>(),
      remoteEditors: () => new Map<string, { name: string }>(),
      autoEditCardId: () => null,
      emitCursor: vi.fn(),
      selectCards: vi.fn(),
    };

    await TestBed.configureTestingModule({
      imports: [
        StructuredCanvasComponent,
        TranslocoTestingModule.forRoot({
          langs: { fr: FR_TRANSLATIONS },
          translocoConfig: { defaultLang: 'fr', availableLangs: ['fr'] },
          preloadLangs: true,
        }),
      ],
      providers: [{ provide: BoardStore, useValue: storeStub }],
    }).compileComponents();

    fixture = TestBed.createComponent(StructuredCanvasComponent);
    fixture.componentRef.setInput('tool', 'frame');
    fixture.detectChanges();
    component = fixture.componentInstance;
  });

  it('placementKind resolves the "frame" tool to a frame-placement gesture', () => {
    expect(component['placementKind']('frame')).toBe('frame');
  });

  it('clicking empty canvas with the frame tool active calls store.addFrame at the click point and consumes the tool', () => {
    const consumed = vi.fn();
    component.toolConsumed.subscribe(consumed);

    const surfaceEl = fixture.nativeElement.querySelector('.wb-surface') as HTMLElement;
    surfaceEl.getBoundingClientRect = vi
      .fn()
      .mockReturnValue({ left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600 }) as unknown as typeof surfaceEl.getBoundingClientRect;
    // jsdom does not implement the Pointer Events capture API.
    (surfaceEl as unknown as { setPointerCapture: (id: number) => void }).setPointerCapture = vi.fn();

    const event = {
      button: 0,
      target: surfaceEl,
      currentTarget: surfaceEl,
      clientX: 120,
      clientY: 80,
      pointerId: 1,
      shiftKey: false,
    } as unknown as PointerEvent;

    component['onPointerDown'](event);

    expect(addFrame).toHaveBeenCalledTimes(1);
    expect(addFrame).toHaveBeenCalledWith(120, 80);
    expect(consumed).toHaveBeenCalledTimes(1);
  });

  it('does not place a frame in read-only mode', () => {
    vi.spyOn(component['store'], 'isReadonly').mockReturnValue(true);
    const surfaceEl = fixture.nativeElement.querySelector('.wb-surface') as HTMLElement;
    surfaceEl.getBoundingClientRect = vi
      .fn()
      .mockReturnValue({ left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600 }) as unknown as typeof surfaceEl.getBoundingClientRect;
    (surfaceEl as unknown as { setPointerCapture: (id: number) => void }).setPointerCapture = vi.fn();

    const event = {
      button: 0,
      target: surfaceEl,
      currentTarget: surfaceEl,
      clientX: 120,
      clientY: 80,
      pointerId: 1,
      shiftKey: false,
    } as unknown as PointerEvent;

    component['onPointerDown'](event);

    expect(addFrame).not.toHaveBeenCalled();
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
  getSessionId(): string {
    return 'recording-transport-session';
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


/**
 * BUG 6 — dragging from a card's connect handle and dropping on another card must create the
 * connector. The surface holds the pointer capture for the whole gesture, so the pointerup's
 * `event.target` is the surface, not the drop-target card; `finishConnect` must hit-test the drop
 * point via `document.elementFromPoint` (parity with PouetPouet's `board-canvas.tsx`).
 */
describe('StructuredCanvasComponent — connect gesture (BUG 6)', () => {
  let fixture: ComponentFixture<StructuredCanvasComponent>;
  let component: StructuredCanvasComponent;
  let addConnection: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    addConnection = vi.fn();
    const storeStub = {
      addConnection,
      isReadonly: () => false,
      frames: () => [],
      cards: () => [
        { id: 'A', posX: 0, posY: 0, width: 100, height: 100 },
        { id: 'B', posX: 400, posY: 0, width: 100, height: 100 },
      ],
      connections: () => [],
      fields: () => [],
      selectedIds: () => new Set<string>(),
      remoteEditors: () => new Map<string, { name: string }>(),
      autoEditCardId: () => null,
      emitCursor: vi.fn(),
      selectCards: vi.fn(),
    };

    await TestBed.configureTestingModule({
      imports: [
        StructuredCanvasComponent,
        TranslocoTestingModule.forRoot({
          langs: { fr: FR_TRANSLATIONS },
          translocoConfig: { defaultLang: 'fr', availableLangs: ['fr'] },
          preloadLangs: true,
        }),
      ],
      providers: [{ provide: BoardStore, useValue: storeStub }],
    }).compileComponents();

    fixture = TestBed.createComponent(StructuredCanvasComponent);
    fixture.detectChanges();
    component = fixture.componentInstance;
  });

  it('creates a connector when a connect-handle drag is dropped over another card', () => {
    const surfaceEl = fixture.nativeElement.querySelector('.wb-surface') as HTMLElement;
    surfaceEl.getBoundingClientRect = vi
      .fn()
      .mockReturnValue({ left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600 }) as unknown as typeof surfaceEl.getBoundingClientRect;
    (surfaceEl as unknown as { setPointerCapture: (id: number) => void }).setPointerCapture = vi.fn();
    (surfaceEl as unknown as { releasePointerCapture: (id: number) => void }).releasePointerCapture = vi.fn();

    // pointerdown starts on card A's connect handle.
    const handle = document.createElement('span');
    handle.setAttribute('data-connect', 'E');
    handle.setAttribute('data-card-id', 'A');
    component['onPointerDown']({
      button: 0,
      target: handle,
      currentTarget: surfaceEl,
      clientX: 90,
      clientY: 50,
      pointerId: 1,
      shiftKey: false,
    } as unknown as PointerEvent);

    // Under pointer capture, the pointerup target is the surface; the real drop target (card B) is
    // resolved through document.elementFromPoint.
    const targetCard = document.createElement('div');
    targetCard.setAttribute('data-card-id', 'B');
    const inner = document.createElement('div');
    targetCard.appendChild(inner);
    const efpOriginal = (document as unknown as Record<string, unknown>)['elementFromPoint'];
    (document as unknown as Record<string, unknown>)['elementFromPoint'] = vi.fn().mockReturnValue(inner);

    component['onPointerUp']({
      target: surfaceEl,
      currentTarget: surfaceEl,
      clientX: 450,
      clientY: 50,
      pointerId: 1,
    } as unknown as PointerEvent);

    (document as unknown as Record<string, unknown>)['elementFromPoint'] = efpOriginal;
    expect(addConnection).toHaveBeenCalledTimes(1);
    expect(addConnection).toHaveBeenCalledWith('A', 'B');
  });

  it('highlights the anchor the connector actually attaches to, not the one under the cursor (ITEM anchor)', () => {
    const surfaceEl = fixture.nativeElement.querySelector('.wb-surface') as HTMLElement;
    surfaceEl.getBoundingClientRect = vi
      .fn()
      .mockReturnValue({ left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600 }) as unknown as typeof surfaceEl.getBoundingClientRect;
    (surfaceEl as unknown as { setPointerCapture: (id: number) => void }).setPointerCapture = vi.fn();

    const handle = document.createElement('span');
    handle.setAttribute('data-connect', 'E');
    handle.setAttribute('data-card-id', 'A');
    component['onPointerDown']({
      button: 0,
      target: handle,
      currentTarget: surfaceEl,
      clientX: 90,
      clientY: 50,
      pointerId: 1,
      shiftKey: false,
    } as unknown as PointerEvent);

    // Pointer hovers over card B (rect 400,0,100,100); elementFromPoint resolves the real target.
    const targetCard = document.createElement('div');
    targetCard.setAttribute('data-card-id', 'B');
    const efpOriginal = (document as unknown as Record<string, unknown>)['elementFromPoint'];
    (document as unknown as Record<string, unknown>)['elementFromPoint'] = vi.fn().mockReturnValue(targetCard);

    // Cursor sits near B's TOP (N) edge (450,5) — cursor-nearest would say 'N'. But the connector
    // routes to B's LEFT (W) edge, the side facing source A's centre. The highlight must be W.
    component['onPointerMove']({ clientX: 450, clientY: 5, pointerId: 1 } as unknown as PointerEvent);

    (document as unknown as Record<string, unknown>)['elementFromPoint'] = efpOriginal;

    const hover = component['hoverAnchors']();
    expect(hover?.cardId).toBe('B');
    expect(hover?.points).toHaveLength(4);
    expect(hover?.attach).toBe('W');
  });

  it('does not create a self-connector when dropped back on the source card', () => {
    const surfaceEl = fixture.nativeElement.querySelector('.wb-surface') as HTMLElement;
    surfaceEl.getBoundingClientRect = vi
      .fn()
      .mockReturnValue({ left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600 }) as unknown as typeof surfaceEl.getBoundingClientRect;
    (surfaceEl as unknown as { setPointerCapture: (id: number) => void }).setPointerCapture = vi.fn();
    (surfaceEl as unknown as { releasePointerCapture: (id: number) => void }).releasePointerCapture = vi.fn();

    const handle = document.createElement('span');
    handle.setAttribute('data-connect', 'E');
    handle.setAttribute('data-card-id', 'A');
    component['onPointerDown']({
      button: 0,
      target: handle,
      currentTarget: surfaceEl,
      clientX: 90,
      clientY: 50,
      pointerId: 1,
      shiftKey: false,
    } as unknown as PointerEvent);

    const sourceCard = document.createElement('div');
    sourceCard.setAttribute('data-card-id', 'A');
    const efpOriginal = (document as unknown as Record<string, unknown>)['elementFromPoint'];
    (document as unknown as Record<string, unknown>)['elementFromPoint'] = vi.fn().mockReturnValue(sourceCard);

    component['onPointerUp']({
      target: surfaceEl,
      currentTarget: surfaceEl,
      clientX: 95,
      clientY: 55,
      pointerId: 1,
    } as unknown as PointerEvent);

    (document as unknown as Record<string, unknown>)['elementFromPoint'] = efpOriginal;
    expect(addConnection).not.toHaveBeenCalled();
  });
});

/**
 * ITEM D — double-clicking the empty canvas (select tool) creates a centred post-it, mirroring
 * PouetPouet's `handleCanvasDoubleClick`. A double-click on a card/frame/connector must NOT
 * create one (it bubbles up but is filtered by the `data-*` target guard).
 */
describe('StructuredCanvasComponent — double-click creates a post-it (ITEM D)', () => {
  let fixture: ComponentFixture<StructuredCanvasComponent>;
  let component: StructuredCanvasComponent;
  let addCard: ReturnType<typeof vi.fn>;

  function makeStore(readonly: boolean) {
    return {
      addCard,
      isReadonly: () => readonly,
      frames: () => [],
      cards: () => [],
      connections: () => [],
      fields: () => [],
      selectedIds: () => new Set<string>(),
      remoteEditors: () => new Map<string, { name: string }>(),
      autoEditCardId: () => null,
      emitCursor: vi.fn(),
      selectCards: vi.fn(),
    };
  }

  async function create(tool: string, readonly = false) {
    addCard = vi.fn();
    await TestBed.configureTestingModule({
      imports: [
        StructuredCanvasComponent,
        TranslocoTestingModule.forRoot({
          langs: { fr: FR_TRANSLATIONS },
          translocoConfig: { defaultLang: 'fr', availableLangs: ['fr'] },
          preloadLangs: true,
        }),
      ],
      providers: [{ provide: BoardStore, useValue: makeStore(readonly) }],
    }).compileComponents();

    fixture = TestBed.createComponent(StructuredCanvasComponent);
    fixture.componentRef.setInput('tool', tool);
    fixture.detectChanges();
    component = fixture.componentInstance;
    const surfaceEl = fixture.nativeElement.querySelector('.wb-surface') as HTMLElement;
    surfaceEl.getBoundingClientRect = vi
      .fn()
      .mockReturnValue({ left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600 }) as unknown as typeof surfaceEl.getBoundingClientRect;
    return surfaceEl;
  }

  it('creates a centred TEXT card at the double-click point on the empty surface', async () => {
    const surfaceEl = await create('select');
    // onDoubleClick hit-tests via document.elementFromPoint (jsdom lacks it) — resolve the
    // empty surface (no [data-card-id] ancestor) so the guard lets the creation through.
    const efpOriginal = (document as unknown as Record<string, unknown>)['elementFromPoint'];
    (document as unknown as Record<string, unknown>)['elementFromPoint'] = vi.fn().mockReturnValue(surfaceEl);
    try {
      component['onDoubleClick']({ target: surfaceEl, clientX: 300, clientY: 200 } as unknown as MouseEvent);

      expect(addCard).toHaveBeenCalledTimes(1);
      // Default card is 180×140 → centred: (300-90, 200-70).
      const [px, py, type, content] = addCard.mock.calls[0];
      expect(px).toBe(210);
      expect(py).toBe(130);
      expect(type).toBe('TEXT');
      expect(content).toBe('');
    } finally {
      (document as unknown as Record<string, unknown>)['elementFromPoint'] = efpOriginal;
    }
  });

  it('does NOT create a card when the double-click lands on a card (card handles its own edit)', async () => {
    await create('select');
    const cardEl = document.createElement('div');
    cardEl.setAttribute('data-card-id', 'X');
    const inner = document.createElement('span');
    cardEl.appendChild(inner);
    // The pointer is over the card: elementFromPoint resolves the real hit (inner → [data-card-id]),
    // which the guard must detect regardless of the synthetic event's `target`.
    const efpOriginal = (document as unknown as Record<string, unknown>)['elementFromPoint'];
    (document as unknown as Record<string, unknown>)['elementFromPoint'] = vi.fn().mockReturnValue(inner);
    try {
      component['onDoubleClick']({ target: inner, clientX: 300, clientY: 200 } as unknown as MouseEvent);
      expect(addCard).not.toHaveBeenCalled();
    } finally {
      (document as unknown as Record<string, unknown>)['elementFromPoint'] = efpOriginal;
    }
  });

  it('does nothing outside the select tool', async () => {
    const surfaceEl = await create('sticky');
    component['onDoubleClick']({ target: surfaceEl, clientX: 300, clientY: 200 } as unknown as MouseEvent);
    expect(addCard).not.toHaveBeenCalled();
  });

  it('does nothing in read-only mode', async () => {
    const surfaceEl = await create('select', true);
    component['onDoubleClick']({ target: surfaceEl, clientX: 300, clientY: 200 } as unknown as MouseEvent);
    expect(addCard).not.toHaveBeenCalled();
  });
});

/**
 * BUG F — auto-edit must be one-shot. `store.autoEditCardId` is set to the freshly-created
 * card at creation; if it is never cleared, that last card "monopolises" edit mode (it re-opens
 * on every re-render/re-mount, and no other card can take over). Entering inline edit consumes
 * the flag so it fires exactly once. Wired in {@link StructuredCanvasComponent.onCardEditing}.
 */
describe('StructuredCanvasComponent — BUG F: auto-edit is one-shot', () => {
  let fixture: ComponentFixture<StructuredCanvasComponent>;
  let component: StructuredCanvasComponent;
  let store: BoardStore;

  function cardWith(id: string): Card {
    return {
      id,
      boardId: 'board-1',
      type: 'TEXT',
      content: '',
      meta: null,
      posX: 0,
      posY: 0,
      width: 192,
      height: 128,
      color: '#FFEB3B',
      groupId: null,
      groupColor: null,
      locked: false,
      layer: 1,
      fieldValues: [],
    };
  }

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
    component = fixture.componentInstance;
    store = fixture.debugElement.injector.get(BoardStore);
    fixture.detectChanges();
  });

  afterEach(() => fixture.destroy());

  it('clears autoEditCardId when a card enters edit (editing === true)', () => {
    store.autoEditCardId.set('card-A');

    component['onCardEditing'](cardWith('card-A'), true);

    expect(store.autoEditCardId()).toBeNull();
  });

  it('lets any OTHER card take over edit afterwards — the last-created no longer monopolises', () => {
    // Card A was the last created → flagged for auto-edit.
    store.autoEditCardId.set('card-A');
    // A enters edit once (consumes the flag)…
    component['onCardEditing'](cardWith('card-A'), true);
    expect(store.autoEditCardId()).toBeNull();

    // …then the user double-clicks card B to edit it. Nothing must re-pin edit onto A.
    component['onCardEditing'](cardWith('card-B'), true);
    expect(store.autoEditCardId()).toBeNull();
  });

  it('does not clear autoEditCardId when a card LEAVES edit (editing === false)', () => {
    store.autoEditCardId.set('card-A');

    component['onCardEditing'](cardWith('card-A'), false);

    expect(store.autoEditCardId()).toBe('card-A');
  });
});

/**
 * ITEM H — middle mouse button (button 1, the wheel click) pans the canvas exactly like
 * space+drag or the pan tool, regardless of the active tool, and suppresses the browser's
 * default middle-click behaviour (autoscroll / context actions).
 */
describe('StructuredCanvasComponent — ITEM H: middle-button pan', () => {
  let fixture: ComponentFixture<StructuredCanvasComponent>;
  let component: StructuredCanvasComponent;

  beforeEach(async () => {
    const storeStub = {
      isReadonly: () => false,
      frames: () => [],
      cards: () => [],
      connections: () => [],
      selectedIds: () => new Set<string>(),
      remoteEditors: () => new Map<string, { name: string }>(),
      autoEditCardId: () => null,
      fields: () => [],
      emitCursor: vi.fn(),
      selectCards: vi.fn(),
      addCard: vi.fn(),
    };

    await TestBed.configureTestingModule({
      imports: [
        StructuredCanvasComponent,
        TranslocoTestingModule.forRoot({
          langs: { fr: FR_TRANSLATIONS },
          translocoConfig: { defaultLang: 'fr', availableLangs: ['fr'] },
          preloadLangs: true,
        }),
      ],
      providers: [{ provide: BoardStore, useValue: storeStub }],
    }).compileComponents();

    fixture = TestBed.createComponent(StructuredCanvasComponent);
    // A non-default tool proves the middle button pans regardless of the active tool.
    fixture.componentRef.setInput('tool', 'sticky');
    fixture.detectChanges();
    component = fixture.componentInstance;
  });

  afterEach(() => fixture.destroy());

  function surface(): HTMLElement {
    const el = fixture.nativeElement.querySelector('.wb-surface') as HTMLElement;
    el.getBoundingClientRect = vi
      .fn()
      .mockReturnValue({ left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600 }) as unknown as typeof el.getBoundingClientRect;
    (el as unknown as { setPointerCapture: (id: number) => void }).setPointerCapture = vi.fn();
    (el as unknown as { releasePointerCapture: (id: number) => void }).releasePointerCapture = vi.fn();
    return el;
  }

  it('routes a middle-button (button 1) pointerdown to a pan gesture, preventing default', () => {
    const surfaceEl = surface();
    const preventDefault = vi.fn();
    component['onPointerDown']({
      button: 1,
      target: surfaceEl,
      currentTarget: surfaceEl,
      clientX: 100,
      clientY: 100,
      pointerId: 1,
      shiftKey: false,
      preventDefault,
    } as unknown as PointerEvent);

    expect(preventDefault).toHaveBeenCalled();

    // Dragging with the wheel held pans the viewport by the pointer delta.
    component['onPointerMove']({
      clientX: 150,
      clientY: 130,
      pointerId: 1,
    } as unknown as PointerEvent);

    expect(component['viewport']()).toEqual({ x: 50, y: 30, zoom: 1 });
  });

  it('does not create a card on middle-button down even though a placement tool is active', () => {
    const surfaceEl = surface();
    component['onPointerDown']({
      button: 1,
      target: surfaceEl,
      currentTarget: surfaceEl,
      clientX: 100,
      clientY: 100,
      pointerId: 1,
      shiftKey: false,
      preventDefault: vi.fn(),
    } as unknown as PointerEvent);

    expect(component['store'].addCard).not.toHaveBeenCalled();
  });
});


/**
 * ITEM I (polish/card-autogrow-anchor): a TEXT/LABEL card whose committed text overflows its stored
 * height asks the canvas to grow it. The canvas persists that through the existing `card:resize`
 * contract (`BoardStore.resizeCard`) — width untouched, only the height grows.
 */
describe('StructuredCanvasComponent — ITEM I: auto-grow relay', () => {
  let fixture: ComponentFixture<StructuredCanvasComponent>;
  let component: StructuredCanvasComponent;
  let resizeCard: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    resizeCard = vi.fn();
    const storeStub = {
      isReadonly: () => false,
      frames: () => [],
      cards: () => [],
      connections: () => [],
      selectedIds: () => new Set<string>(),
      remoteEditors: () => new Map<string, { name: string }>(),
      autoEditCardId: () => null,
      fields: () => [],
      emitCursor: vi.fn(),
      selectCards: vi.fn(),
      resizeCard,
    };

    await TestBed.configureTestingModule({
      imports: [
        StructuredCanvasComponent,
        TranslocoTestingModule.forRoot({
          langs: { fr: FR_TRANSLATIONS },
          translocoConfig: { defaultLang: 'fr', availableLangs: ['fr'] },
          preloadLangs: true,
        }),
      ],
      providers: [{ provide: BoardStore, useValue: storeStub }],
    }).compileComponents();

    fixture = TestBed.createComponent(StructuredCanvasComponent);
    fixture.detectChanges();
    component = fixture.componentInstance;
  });

  afterEach(() => fixture.destroy());

  it('persists a grown height via resizeCard, keeping the card width unchanged', () => {
    const card = { id: 'A', width: 192, height: 128 } as unknown as Card;
    component['onCardHeightGrow'](card, 260);
    expect(resizeCard).toHaveBeenCalledTimes(1);
    expect(resizeCard).toHaveBeenCalledWith('A', 192, 260);
  });
});
