import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
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

  it('does not create a card when the pasted text is not a URL by itself', () => {
    const addCard = vi.spyOn(store, 'addCard');
    document.dispatchEvent(pasteEventWith('just some plain text'));
    document.dispatchEvent(pasteEventWith('check this out: https://example.com'));

    expect(addCard).not.toHaveBeenCalled();
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
