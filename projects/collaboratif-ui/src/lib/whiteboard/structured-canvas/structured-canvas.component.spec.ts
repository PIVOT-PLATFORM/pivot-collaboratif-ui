import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter, Router } from '@angular/router';
import { TranslocoTestingModule } from '@jsverse/transloco';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StructuredCanvasComponent } from './structured-canvas.component';
import { BoardStore } from '../../core/whiteboard/board.store';
import { DEFAULT_CARD_COLOR, DEFAULT_SHAPE_COLOR } from '../model/colors';
import { BoardTransport } from '../../core/whiteboard/board-transport';
import { COLLABORATIF_API_URL } from '../../core/whiteboard/config/tokens';
import type { Card } from '../model/board.types';
import { parseShape } from '../model/shape';
import { LINE_MIN } from '../model/board-constants';

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
 * A colour the user actively picked must apply to whatever they create next, whatever its type —
 * a recette finding: every type except SHAPE/DRAW hard-coded its default and silently ignored the
 * pick. The `colorPicked` gate keeps an untouched board's defaults intact (`color` starts at the
 * *shape* colour, so inheriting it unconditionally would turn fresh post-its indigo).
 */
describe('StructuredCanvasComponent — picked colour on card creation', () => {
  let fixture: ComponentFixture<StructuredCanvasComponent>;
  let component: StructuredCanvasComponent;
  let addCard: ReturnType<typeof vi.fn>;

  const PICKED = '#FCA5A5';

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

    fixture = TestBed.createComponent(StructuredCanvasComponent);
    component = fixture.componentInstance;
  });

  /** Colour is the 5th positional argument of `addCard(x, y, type, content, color, w, h)`. */
  function colorOfLastCard(): string {
    return addCard.mock.calls[0][4] as string;
  }

  it('keeps the post-it default while no colour has been picked', () => {
    fixture.componentRef.setInput('color', DEFAULT_SHAPE_COLOR);
    fixture.componentRef.setInput('colorPicked', false);
    component['createCard']('sticky', 100, 50);
    expect(colorOfLastCard()).toBe(DEFAULT_CARD_COLOR);
  });

  it('applies a picked colour to a new post-it', () => {
    fixture.componentRef.setInput('color', PICKED);
    fixture.componentRef.setInput('colorPicked', true);
    component['createCard']('sticky', 100, 50);
    expect(colorOfLastCard()).toBe(PICKED);
  });

  it('applies a picked colour to a new label', () => {
    fixture.componentRef.setInput('color', PICKED);
    fixture.componentRef.setInput('colorPicked', true);
    component['createCard']('text', 100, 50);
    expect(colorOfLastCard()).toBe(PICKED);
  });

  it('keeps the table default white while no colour has been picked, and honours a pick', () => {
    fixture.componentRef.setInput('colorPicked', false);
    component['createCard']('table', 100, 50);
    expect(colorOfLastCard()).toBe('#FFFFFF');

    addCard.mockClear();
    fixture.componentRef.setInput('color', PICKED);
    fixture.componentRef.setInput('colorPicked', true);
    component['createCard']('table', 100, 50);
    expect(colorOfLastCard()).toBe(PICKED);
  });

  it('leaves SHAPE on the active colour regardless of the gate (it never ignored the pick)', () => {
    fixture.componentRef.setInput('tool', 'rect');
    fixture.componentRef.setInput('color', PICKED);
    fixture.componentRef.setInput('colorPicked', false);
    component['createCard']('shape', 100, 50);
    expect(colorOfLastCard()).toBe(PICKED);
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
      activeVoteSession: () => null,
      voteTallyByCard: () => new Map<string, number>(),
      myVoteTallyByCard: () => new Map<string, number>(),
      voteBudgetRemaining: () => null,
      emitCursor: vi.fn(),
      selectCards: vi.fn(),
      castVote: vi.fn(),
      uncastVote: vi.fn(),
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

/**
 * US08.8.1/.2 — pointer-down on a frame's header must *select* the frame, not only start a drag.
 * Selection is what reveals the frame's resize handles (`@if (selected())` in `frame-item`) and
 * what lets Delete remove it: before this, no path ever put a frame id into `selectedIds`, so a
 * frame could be neither resized nor deleted even though both mechanisms existed.
 */
describe('StructuredCanvasComponent — frame selection on header pointer-down', () => {
  let fixture: ComponentFixture<StructuredCanvasComponent>;
  let component: StructuredCanvasComponent;
  let selectCards: ReturnType<typeof vi.fn>;
  let startDragFrame: ReturnType<typeof vi.fn>;
  let selected: Set<string>;

  const FRAME = { id: 'frame-1', posX: 0, posY: 0, width: 400, height: 300, active: false };

  beforeEach(async () => {
    selectCards = vi.fn();
    startDragFrame = vi.fn();
    selected = new Set<string>();
    const storeStub = {
      isReadonly: () => false,
      frames: () => [FRAME],
      cards: () => [],
      connections: () => [],
      fields: () => [],
      selectedIds: () => selected,
      remoteEditors: () => new Map<string, { name: string }>(),
      autoEditCardId: () => null,
      activeVoteSession: () => null,
      voteTallyByCard: () => new Map<string, number>(),
      myVoteTallyByCard: () => new Map<string, number>(),
      voteBudgetRemaining: () => null,
      emitCursor: vi.fn(),
      selectCards,
      startDragFrame,
      castVote: vi.fn(),
      uncastVote: vi.fn(),
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

  /**
   * A connector emits its selection on `click`. Capturing the pointer on the surface routed the
   * click there, so clicking a connector selected nothing — and with nothing selected the bottom
   * bar never appeared, which is where its style now lives (recette 2026-07-17). Same cause as the
   * frame header below.
   */
  it('starts no gesture at all when the pointer lands on a connector', () => {
    const surfaceEl = fixture.nativeElement.querySelector('.wb-surface') as HTMLElement;
    const capture = vi.fn();
    (surfaceEl as unknown as { setPointerCapture: (id: number) => void }).setPointerCapture = capture;
    const hit = document.createElement('span');
    hit.setAttribute('data-connection-hit', '');

    component['onPointerDown']({
      button: 0,
      target: hit,
      currentTarget: surfaceEl,
      clientX: 40,
      clientY: 40,
      pointerId: 1,
    } as unknown as PointerEvent);

    expect(capture).not.toHaveBeenCalled();
    // And no marquee either: the second pointerdown of a double-click would otherwise end with a
    // degenerate rect that clears the selection before the dblclick fires.
    expect(selectCards).not.toHaveBeenCalled();
    expect(component['marquee']()).toBeNull();
  });

  /**
   * The frame header is a drag zone, and its buttons (z-order, magnet, delete) and title live
   * inside it. Starting a gesture on them captured the pointer on the surface, so their
   * `click`/`dblclick` never fired — the delete button did nothing and the title could not be
   * renamed (recette 2026-07-17). Both symptoms, one cause.
   */
  it('does not start a gesture when the pointer lands on a control inside the frame header', () => {
    const surfaceEl = fixture.nativeElement.querySelector('.wb-surface') as HTMLElement;
    const capture = vi.fn();
    (surfaceEl as unknown as { setPointerCapture: (id: number) => void }).setPointerCapture = capture;
    const headerEl = fixture.nativeElement.querySelector('[data-frame-drag]') as HTMLElement;
    const button = document.createElement('button');
    headerEl.appendChild(button);

    component['onPointerDown']({
      button: 0,
      target: button,
      currentTarget: surfaceEl,
      clientX: 40,
      clientY: 10,
      pointerId: 1,
    } as unknown as PointerEvent);

    // No pointer capture, no drag, no selection — the click is left to the button.
    expect(capture).not.toHaveBeenCalled();
    expect(startDragFrame).not.toHaveBeenCalled();
    expect(selectCards).not.toHaveBeenCalled();
  });

  /** Builds a pointer-down landing on the frame header (`[data-frame-drag]`). */
  function headerPointerDown(shiftKey = false): PointerEvent {
    const surfaceEl = fixture.nativeElement.querySelector('.wb-surface') as HTMLElement;
    surfaceEl.getBoundingClientRect = vi
      .fn()
      .mockReturnValue({ left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600 }) as unknown as typeof surfaceEl.getBoundingClientRect;
    (surfaceEl as unknown as { setPointerCapture: (id: number) => void }).setPointerCapture = vi.fn();
    const headerEl = fixture.nativeElement.querySelector('[data-frame-drag]') as HTMLElement;
    return {
      button: 0,
      target: headerEl,
      currentTarget: surfaceEl,
      clientX: 40,
      clientY: 10,
      pointerId: 1,
      shiftKey,
    } as unknown as PointerEvent;
  }

  it('selects the frame alone on a plain header click', () => {
    component['onPointerDown'](headerPointerDown());

    expect(selectCards).toHaveBeenCalledTimes(1);
    expect(selectCards.mock.calls[0][0]).toEqual(new Set(['frame-1']));
    expect(startDragFrame).toHaveBeenCalledWith('frame-1', []);
  });

  it('Shift+click adds the frame to the current selection rather than replacing it', () => {
    selected = new Set(['card-a']);
    component['onPointerDown'](headerPointerDown(true));

    expect(selectCards.mock.calls[0][0]).toEqual(new Set(['card-a', 'frame-1']));
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
      activeVoteSession: () => null,
      voteTallyByCard: () => new Map<string, number>(),
      myVoteTallyByCard: () => new Map<string, number>(),
      voteBudgetRemaining: () => null,
      emitCursor: vi.fn(),
      selectCards: vi.fn(),
      castVote: vi.fn(),
      uncastVote: vi.fn(),
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
    // The toolbar presets ride along with the creation — defaults here, since none was picked.
    expect(addConnection).toHaveBeenCalledWith('A', 'B', { startCap: 'none', endCap: 'none', lineStyle: 'solid' });
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
  let requestEdit: ReturnType<typeof vi.fn>;

  function makeStore(readonly: boolean) {
    return {
      addCard,
      requestEdit,
      isReadonly: () => readonly,
      frames: () => [],
      cards: () => [],
      connections: () => [],
      fields: () => [],
      selectedIds: () => new Set<string>(),
      remoteEditors: () => new Map<string, { name: string }>(),
      autoEditCardId: () => null,
      activeVoteSession: () => null,
      voteTallyByCard: () => new Map<string, number>(),
      myVoteTallyByCard: () => new Map<string, number>(),
      voteBudgetRemaining: () => null,
      emitCursor: vi.fn(),
      selectCards: vi.fn(),
      castVote: vi.fn(),
      uncastVote: vi.fn(),
    };
  }

  async function create(tool: string, readonly = false) {
    addCard = vi.fn();
    requestEdit = vi.fn();
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
      // Instead of spawning a card, it opens the double-clicked card's inline editor — the
      // card's own (dblclick) never fires because the surface captured the pointer.
      expect(requestEdit).toHaveBeenCalledWith('X');
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

/**
 * Free-draw tool behaviour:
 *  - the stroke is shown live (`drawPreview`) while the pointer moves, not only on release;
 *  - a committed stroke creates a DRAW card but the tool STAYS active (no `toolConsumed`), so the
 *    user can keep drawing without re-selecting the pencil — unlike placement tools.
 */
describe('StructuredCanvasComponent — free-draw tool', () => {
  let fixture: ComponentFixture<StructuredCanvasComponent>;
  let component: StructuredCanvasComponent;
  let addCard: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    addCard = vi.fn();
    const storeStub = {
      addCard,
      isReadonly: () => false,
      frames: () => [],
      cards: () => [],
      connections: () => [],
      fields: () => [],
      selectedIds: () => new Set<string>(),
      remoteEditors: () => new Map<string, { name: string }>(),
      autoEditCardId: () => null,
      activeVoteSession: () => null,
      voteTallyByCard: () => new Map<string, number>(),
      myVoteTallyByCard: () => new Map<string, number>(),
      voteBudgetRemaining: () => null,
      emitCursor: vi.fn(),
      selectCards: vi.fn(),
      castVote: vi.fn(),
      uncastVote: vi.fn(),
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
    fixture.componentRef.setInput('tool', 'draw');
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

  it('renders the stroke live as the pointer moves, before release', () => {
    const el = surface();
    component['onPointerDown']({ button: 0, target: el, currentTarget: el, clientX: 10, clientY: 20, pointerId: 1, shiftKey: false } as unknown as PointerEvent);
    component['onPointerMove']({ clientX: 40, clientY: 60, pointerId: 1 } as unknown as PointerEvent);

    // The preview path exists mid-gesture (nothing committed yet).
    const d = component['drawPreview']();
    expect(d).toBe('M10.0,20.0 L40.0,60.0');
    expect(addCard).not.toHaveBeenCalled();

    fixture.detectChanges();
    const path = fixture.nativeElement.querySelector('.wb-draw-preview') as SVGPathElement | null;
    expect(path).not.toBeNull();
    expect(path?.getAttribute('d')).toBe('M10.0,20.0 L40.0,60.0');
  });

  it('commits a DRAW card and keeps the draw tool active (no toolConsumed), clearing the preview', () => {
    const consumed = vi.fn();
    component.toolConsumed.subscribe(consumed);
    const el = surface();

    component['onPointerDown']({ button: 0, target: el, currentTarget: el, clientX: 10, clientY: 20, pointerId: 1, shiftKey: false } as unknown as PointerEvent);
    component['onPointerMove']({ clientX: 40, clientY: 60, pointerId: 1 } as unknown as PointerEvent);
    component['onPointerUp']({ target: el, currentTarget: el, clientX: 40, clientY: 60, pointerId: 1 } as unknown as PointerEvent);

    // Stroke committed as a DRAW card, path stored relative to its top-left corner (10,20).
    expect(addCard).toHaveBeenCalledTimes(1);
    const [minX, minY, type, d] = addCard.mock.calls[0];
    expect([minX, minY, type]).toEqual([10, 20, 'DRAW']);
    expect(d).toBe('M0.0,0.0 L30.0,40.0');

    // The pencil stays selected (placement tools would emit here) and the preview is cleared.
    expect(consumed).not.toHaveBeenCalled();
    expect(component['drawPreview']()).toBeNull();
  });
});

/**
 * Resize modifiers — Shift keeps the start aspect ratio, Alt resizes from the start centre.
 * Reported in recette: "les formes préexistantes: il n'est pas possible de garder le ratio".
 *
 * The gestures are driven through the real pointer state machine (`onPointerDown` on a synthetic
 * handle, then `onPointerMove`) rather than by calling the geometry helper directly, so the tests
 * also cover the wiring that reads `shiftKey`/`altKey` off the live event.
 */
describe('StructuredCanvasComponent — resize modifiers (Shift = ratio, Alt = from centre)', () => {
  let fixture: ComponentFixture<StructuredCanvasComponent>;
  let component: StructuredCanvasComponent;
  let resizeCardBox: ReturnType<typeof vi.fn>;
  let resizeFrameBox: ReturnType<typeof vi.fn>;
  let updateCard: ReturnType<typeof vi.fn>;
  let previewCardContent: ReturnType<typeof vi.fn>;

  /** A 200×100 card (ratio 2) — a non-square start box makes a broken ratio visible. */
  const CARD = { id: 'A', posX: 100, posY: 100, width: 200, height: 100, type: 'STICKY', text: '', color: '#FFF' } as unknown as Card;
  /** A line card — its box may flatten, unlike every other shape (see the per-type floor). */
  const LINE = { id: 'L', posX: 100, posY: 100, width: 200, height: 100, type: 'SHAPE', content: 'line|#A5B4FC|none|1|0|tlbr', text: '', color: '#FFF' } as unknown as Card;
  const FRAME = { id: 'F', posX: 0, posY: 0, width: 400, height: 200, active: false };

  beforeEach(async () => {
    resizeCardBox = vi.fn();
    resizeFrameBox = vi.fn();
    updateCard = vi.fn();
    previewCardContent = vi.fn();
    const storeStub = {
      isReadonly: () => false,
      frames: () => [FRAME],
      cards: () => [CARD, LINE],
      connections: () => [],
      fields: () => [],
      selectedIds: () => new Set<string>(['A']),
      remoteEditors: () => new Map<string, { name: string }>(),
      autoEditCardId: () => null,
      activeVoteSession: () => null,
      voteTallyByCard: () => new Map<string, number>(),
      myVoteTallyByCard: () => new Map<string, number>(),
      voteBudgetRemaining: () => null,
      emitCursor: vi.fn(),
      selectCards: vi.fn(),
      castVote: vi.fn(),
      uncastVote: vi.fn(),
      startResizeCard: vi.fn(),
      startResizeFrame: vi.fn(),
      commitResizeCard: vi.fn(),
      commitResizeFrame: vi.fn(),
      updateCard,
      previewCardContent,
      resizeCardBox,
      resizeFrameBox,
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

  function surface(): HTMLElement {
    const el = fixture.nativeElement.querySelector('.wb-surface') as HTMLElement;
    el.getBoundingClientRect = vi
      .fn()
      .mockReturnValue({ left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600 }) as unknown as typeof el.getBoundingClientRect;
    (el as unknown as { setPointerCapture: (id: number) => void }).setPointerCapture = vi.fn();
    return el;
  }

  /**
   * Starts a resize gesture on `dir`, then drags by (dx, dy) with the given modifiers.
   * The handle is a detached element carrying the same data-attributes the templates render —
   * `closest()` resolves it exactly as it does on the real DOM.
   */
  function resize(attr: string, id: string, dir: string, dx: number, dy: number, mods: { shiftKey?: boolean; altKey?: boolean } = {}): void {
    const el = surface();
    const handle = document.createElement('span');
    handle.setAttribute(attr, dir);
    handle.setAttribute(attr === 'data-resize-dir' ? 'data-card-id' : 'data-frame-id', id);
    component['onPointerDown']({ button: 0, target: handle, currentTarget: el, clientX: 0, clientY: 0, pointerId: 1 } as unknown as PointerEvent);
    component['onPointerMove']({ clientX: dx, clientY: dy, pointerId: 1, shiftKey: false, altKey: false, ...mods } as unknown as PointerEvent);
  }

  const resizeCard = (dir: string, dx: number, dy: number, mods?: { shiftKey?: boolean; altKey?: boolean }) =>
    resize('data-resize-dir', 'A', dir, dx, dy, mods);
  const resizeFrame = (dir: string, dx: number, dy: number, mods?: { shiftKey?: boolean; altKey?: boolean }) =>
    resize('data-frame-resize-dir', 'F', dir, dx, dy, mods);

  it('without Shift, resizes each axis independently (ratio free)', () => {
    resizeCard('br', 100, 0);

    // Only the width follows the pointer — the height is untouched, so the ratio drifts to 3.
    expect(resizeCardBox).toHaveBeenLastCalledWith('A', { posX: 100, posY: 100, width: 300, height: 100 });
  });

  it('with Shift on a corner handle, keeps the start ratio', () => {
    resizeCard('br', 100, 0, { shiftKey: true });

    // Width 200→300 is a ×1.5 scale; the height follows to hold the start ratio of 2.
    expect(resizeCardBox).toHaveBeenLastCalledWith('A', { posX: 100, posY: 100, width: 300, height: 150 });
  });

  it('with Shift, the dominant drag axis drives the scale', () => {
    // The pointer pushes the height much further (×2) than the width (×1.25) — the height wins.
    resizeCard('br', 50, 100, { shiftKey: true });

    expect(resizeCardBox).toHaveBeenLastCalledWith('A', { posX: 100, posY: 100, width: 400, height: 200 });
  });

  it('with Shift on a top-left corner, re-anchors on the opposite corner', () => {
    // Dragging `tl` outwards grows the box; its bottom-right corner (300,200) must stay put.
    resizeCard('tl', -100, 0, { shiftKey: true });

    expect(resizeCardBox).toHaveBeenLastCalledWith('A', { posX: 0, posY: 50, width: 300, height: 150 });
  });

  it('ignores Shift on a side handle, where a locked ratio is undefined (as in Figma)', () => {
    resizeCard('r', 100, 0, { shiftKey: true });

    expect(resizeCardBox).toHaveBeenLastCalledWith('A', { posX: 100, posY: 100, width: 300, height: 100 });
  });

  it('with Alt, grows from the start centre — both sides move by the drag delta', () => {
    resizeCard('br', 50, 0, { altKey: true });

    // +50 on each side: width 200→300, and the centre (200,150) stays put.
    expect(resizeCardBox).toHaveBeenLastCalledWith('A', { posX: 50, posY: 100, width: 300, height: 100 });
  });

  it('combines Shift and Alt — ratio kept, centre fixed', () => {
    resizeCard('br', 50, 0, { shiftKey: true, altKey: true });

    expect(resizeCardBox).toHaveBeenLastCalledWith('A', { posX: 50, posY: 75, width: 300, height: 150 });
  });

  it('freezes the ratio at the gesture start, so it cannot drift over successive moves', () => {
    const el = surface();
    const handle = document.createElement('span');
    handle.setAttribute('data-resize-dir', 'br');
    handle.setAttribute('data-card-id', 'A');
    component['onPointerDown']({ button: 0, target: handle, currentTarget: el, clientX: 0, clientY: 0, pointerId: 1 } as unknown as PointerEvent);
    component['onPointerMove']({ clientX: 40, clientY: 0, pointerId: 1, shiftKey: true } as unknown as PointerEvent);
    component['onPointerMove']({ clientX: 100, clientY: 0, pointerId: 1, shiftKey: true } as unknown as PointerEvent);

    // The second move is computed from the *start* box, not from the first move's result — so the
    // ratio is still exactly 2 and the box matches a single 100px drag.
    expect(resizeCardBox).toHaveBeenLastCalledWith('A', { posX: 100, posY: 100, width: 300, height: 150 });
  });

  /**
   * A line is two points, not a box: dragging an endpoint moves that point, the other staying put.
   * Recette: « j'aimerai vraiment que les lignes soit vraiment une ligne et qu'il soit uniquement
   * possible de modifier les extrémités. »
   */
  it('moves the dragged endpoint of a line, keeping the other one fixed', () => {
    const el = surface();
    const handle = document.createElement('span');
    handle.setAttribute('data-resize-dir', 'br');
    handle.setAttribute('data-card-id', 'L');
    component['onPointerDown']({ button: 0, target: handle, currentTarget: el, clientX: 0, clientY: 0, pointerId: 1 } as unknown as PointerEvent);
    // LINE spans (100,100)→(300,200); the fixed end is its top-left corner.
    component['onPointerMove']({ clientX: 500, clientY: 400, pointerId: 1, shiftKey: false, altKey: false } as unknown as PointerEvent);

    // The box now runs from the fixed end to the pointer — not a box-relative delta.
    expect(resizeCardBox).toHaveBeenLastCalledWith('L', { posX: 100, posY: 100, width: 400, height: 300 });
  });

  /**
   * Dragging one end past the other is a normal gesture — it simply turns the line over. Going
   * through the box resize instead would clamp at the minimum and the line would refuse to flip.
   */
  it('flips the diagonal when an endpoint is dragged past the other', () => {
    const el = surface();
    const handle = document.createElement('span');
    handle.setAttribute('data-resize-dir', 'br');
    handle.setAttribute('data-card-id', 'L');
    component['onPointerDown']({ button: 0, target: handle, currentTarget: el, clientX: 0, clientY: 0, pointerId: 1 } as unknown as PointerEvent);
    // Drag the bottom-right end above-right of the fixed top-left end: the line now runs bottom-
    // left → top-right.
    component['onPointerMove']({ clientX: 400, clientY: 20, pointerId: 1, shiftKey: false, altKey: false } as unknown as PointerEvent);
    component['onPointerUp']({ target: el, currentTarget: el, clientX: 400, clientY: 20, pointerId: 1 } as unknown as PointerEvent);

    expect(updateCard).toHaveBeenCalledTimes(1);
    expect(parseShape(updateCard.mock.calls[0][1]).diag).toBe('bltr');
  });

  /**
   * Swinging an endpoint around the fixed one (recette: « si je prends une extremité et que
   * j'essaie de faire le tour du point que l'on ne bouge pas, il se met a bouger également si on
   * dépasse un certain angle »). The box was recomputed correctly, but the line is drawn along
   * whichever diagonal `content` names — left stale until release, it was drawn on the wrong one
   * past 90°, so *both* ends appeared to move. The repaint is local; nothing is emitted until the
   * pointer is released.
   */
  it('repaints the diagonal live while an endpoint swings around the fixed one', () => {
    const el = surface();
    const handle = document.createElement('span');
    handle.setAttribute('data-resize-dir', 'br');
    handle.setAttribute('data-card-id', 'L');
    component['onPointerDown']({ button: 0, target: handle, currentTarget: el, clientX: 0, clientY: 0, pointerId: 1 } as unknown as PointerEvent);

    // Still below-right of the fixed end (100,100): same diagonal, nothing to repaint.
    component['onPointerMove']({ clientX: 400, clientY: 300, pointerId: 1, shiftKey: false } as unknown as PointerEvent);
    expect(previewCardContent).not.toHaveBeenCalled();

    // Swung above the fixed end: the line now runs the other way.
    component['onPointerMove']({ clientX: 400, clientY: 40, pointerId: 1, shiftKey: false } as unknown as PointerEvent);
    expect(previewCardContent).toHaveBeenCalledTimes(1);
    expect(parseShape(previewCardContent.mock.calls[0][1]).diag).toBe('bltr');
    // Local only — the room hears about it once, on release.
    expect(updateCard).not.toHaveBeenCalled();
  });

  /** Nothing to rewrite when the gesture kept the same orientation — no needless card:update. */
  it('leaves the content alone when the diagonal did not change', () => {
    const el = surface();
    const handle = document.createElement('span');
    handle.setAttribute('data-resize-dir', 'br');
    handle.setAttribute('data-card-id', 'L');
    component['onPointerDown']({ button: 0, target: handle, currentTarget: el, clientX: 0, clientY: 0, pointerId: 1 } as unknown as PointerEvent);
    component['onPointerMove']({ clientX: 500, clientY: 400, pointerId: 1, shiftKey: false, altKey: false } as unknown as PointerEvent);
    component['onPointerUp']({ target: el, currentTarget: el, clientX: 500, clientY: 400, pointerId: 1 } as unknown as PointerEvent);

    expect(updateCard).not.toHaveBeenCalled();
  });

  /**
   * A line must be allowed to go flat on an axis to stay straight — a 0px-high box renders nothing
   * at all, so the endpoint logic keeps a 1px floor rather than letting it collapse.
   */
  it('lets a line endpoint land on a straight horizontal without collapsing the box', () => {
    const el = surface();
    const handle = document.createElement('span');
    handle.setAttribute('data-resize-dir', 'br');
    handle.setAttribute('data-card-id', 'L');
    component['onPointerDown']({ button: 0, target: handle, currentTarget: el, clientX: 0, clientY: 0, pointerId: 1 } as unknown as PointerEvent);
    // Dead level with the fixed end (y = 100): a truly horizontal line.
    component['onPointerMove']({ clientX: 400, clientY: 100, pointerId: 1, shiftKey: false, altKey: false } as unknown as PointerEvent);

    expect(resizeCardBox).toHaveBeenLastCalledWith('L', { posX: 100, posY: 100, width: 300, height: LINE_MIN });
  });

  it('still holds every other shape to the 80px minimum', () => {
    resizeCard('b', 0, -1000);

    const box = resizeCardBox.mock.lastCall?.[1] as { height: number };
    expect(box.height).toBe(80);
  });

  it('never shrinks a card below the minimum, even while holding the ratio', () => {
    resizeCard('br', -1000, -1000, { shiftKey: true });

    const box = resizeCardBox.mock.lastCall?.[1] as { width: number; height: number };
    expect(box.width).toBeGreaterThanOrEqual(80);
    expect(box.height).toBeGreaterThanOrEqual(80);
    expect(box.width / box.height).toBeCloseTo(2);
  });

  it('applies the same modifiers to frames', () => {
    resizeFrame('br', 200, 0, { shiftKey: true });

    // Frame ratio 400/200 = 2 — width 400→600 (×1.5) pulls the height to 300.
    expect(resizeFrameBox).toHaveBeenLastCalledWith('F', 0, 0, 600, 300);
  });
});

/**
 * Line tool — dragged, not clicked (recette: "les trait ne sont toujours pas utilisable en l'état.
 * horizontal forcé + forme rectangulaire lors de la selection").
 *
 * The line used to be clicked into a fixed 120×120 box and rendered from a hard-coded
 * `<line x1="2" y1="50" x2="98" y2="50">` — hence horizontal whatever the box, inside a square
 * selection outline. It is now the *diagonal of its box*: the drag gives the box, and `diag` says
 * which diagonal the pointer travelled, which together reproduce any segment.
 */
describe('StructuredCanvasComponent — line tool', () => {
  let fixture: ComponentFixture<StructuredCanvasComponent>;
  let component: StructuredCanvasComponent;
  let addCard: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    addCard = vi.fn();
    const storeStub = {
      addCard,
      isReadonly: () => false,
      frames: () => [],
      cards: () => [],
      connections: () => [],
      fields: () => [],
      selectedIds: () => new Set<string>(),
      remoteEditors: () => new Map<string, { name: string }>(),
      autoEditCardId: () => null,
      activeVoteSession: () => null,
      voteTallyByCard: () => new Map<string, number>(),
      myVoteTallyByCard: () => new Map<string, number>(),
      voteBudgetRemaining: () => null,
      emitCursor: vi.fn(),
      selectCards: vi.fn(),
      castVote: vi.fn(),
      uncastVote: vi.fn(),
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
    fixture.componentRef.setInput('tool', 'line');
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

  /** Drags a line from (x1,y1) to (x2,y2), optionally holding Shift for the angle snap. */
  function dragLine(x1: number, y1: number, x2: number, y2: number, shiftKey = false): void {
    const el = surface();
    component['onPointerDown']({ button: 0, target: el, currentTarget: el, clientX: x1, clientY: y1, pointerId: 1 } as unknown as PointerEvent);
    component['onPointerMove']({ clientX: x2, clientY: y2, pointerId: 1, shiftKey } as unknown as PointerEvent);
    component['onPointerUp']({ target: el, currentTarget: el, clientX: x2, clientY: y2, pointerId: 1 } as unknown as PointerEvent);
  }

  /** The parsed spec + box of the single card the gesture committed. */
  function committed() {
    const [posX, posY, type, content, , width, height] = addCard.mock.calls[0];
    return { posX, posY, type, spec: parseShape(content), width, height };
  }

  it('commits a line spanning the drag, as a SHAPE card', () => {
    dragLine(100, 100, 300, 250);

    expect(addCard).toHaveBeenCalledTimes(1);
    const c = committed();
    expect(c.type).toBe('SHAPE');
    expect(c.spec.kind).toBe('line');
    // The box is the drag's bounding box — top-left corner, then its extent.
    expect([c.posX, c.posY, c.width, c.height]).toEqual([100, 100, 200, 150]);
  });

  /** Dragging down-right keeps the sign of dx and dy together: the top-left→bottom-right diagonal. */
  it('records the top-left→bottom-right diagonal for a down-right drag', () => {
    dragLine(100, 100, 300, 250);

    expect(committed().spec.diag).toBe('tlbr');
  });

  /** Dragging up-right crosses the signs: the other diagonal of the very same box. */
  it('records the bottom-left→top-right diagonal for an up-right drag', () => {
    dragLine(100, 250, 300, 100);

    const c = committed();
    expect(c.spec.diag).toBe('bltr');
    // Same box as the down-right drag above — only the diagonal differs.
    expect([c.posX, c.posY, c.width, c.height]).toEqual([100, 100, 200, 150]);
  });

  /** A drag up-left is the same segment as down-right, entered from the other end. */
  it('records the top-left→bottom-right diagonal for an up-left drag', () => {
    dragLine(300, 250, 100, 100);

    expect(committed().spec.diag).toBe('tlbr');
  });

  it('commits nothing for a click that never moved — no degenerate card to hunt down', () => {
    dragLine(100, 100, 100, 100);

    expect(addCard).not.toHaveBeenCalled();
  });

  it('commits nothing for a drag too short to be deliberate', () => {
    dragLine(100, 100, 102, 101);

    expect(addCard).not.toHaveBeenCalled();
  });

  /** Shift snaps the *angle*, which is what makes 15°/30°/45° reachable — not just the axes. */
  it('snaps to the horizontal with Shift when the drag is nearly horizontal', () => {
    dragLine(100, 100, 300, 108, true);

    const c = committed();
    // The 8px of vertical slop is snapped away — but the box keeps a 1px floor rather than
    // collapsing to 0. An earlier version of this test asserted `height === 0` and passed, while
    // the line was invisible on screen: a card 0px high renders nothing at all. Geometry alone
    // could not catch that; only opening the board did.
    expect(c.height).toBe(LINE_MIN);
    // The snap rotates the gesture onto the nearest ray and keeps its length, so the width is the
    // drag's full length (hypot(200, 8) ≈ 200.16), not its horizontal component.
    expect(c.width).toBeCloseTo(Math.hypot(200, 8), 5);
  });

  /** Same floor on the other axis — a vertical line is the mirror case. */
  it('keeps a vertical line from collapsing to a zero-width box', () => {
    dragLine(100, 100, 108, 300, true);

    expect(committed().width).toBe(LINE_MIN);
  });

  it('snaps to 45° with Shift when the drag is nearly diagonal', () => {
    // 43.5° from the horizontal — the nearest 15° multiple is 45°.
    dragLine(100, 100, 300, 290, true);

    const c = committed();
    // On the 45° ray the box is square, so its diagonal is at exactly 45°.
    expect(c.width).toBeCloseTo(c.height, 5);
  });

  /** The nearest ray wins — a 24° drag belongs to 30°, not to the 45° everyone assumes. */
  it('snaps to 30° with Shift when the drag sits nearest that ray', () => {
    dragLine(100, 100, 300, 190, true);

    const c = committed();
    expect(Math.atan2(c.height, c.width) * (180 / Math.PI)).toBeCloseTo(30, 5);
  });

  it('previews the line live while dragging, then clears it on release', () => {
    const el = surface();
    component['onPointerDown']({ button: 0, target: el, currentTarget: el, clientX: 100, clientY: 100, pointerId: 1 } as unknown as PointerEvent);
    component['onPointerMove']({ clientX: 300, clientY: 250, pointerId: 1, shiftKey: false } as unknown as PointerEvent);

    expect(component['linePreview']()).toEqual({ x1: 100, y1: 100, x2: 300, y2: 250 });

    component['onPointerUp']({ target: el, currentTarget: el, clientX: 300, clientY: 250, pointerId: 1 } as unknown as PointerEvent);

    expect(component['linePreview']()).toBeNull();
  });
});
