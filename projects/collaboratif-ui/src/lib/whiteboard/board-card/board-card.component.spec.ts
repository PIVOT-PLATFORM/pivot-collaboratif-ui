import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslocoTestingModule } from '@jsverse/transloco';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Card } from '../model/board.types';
import { BoardCardComponent } from './board-card.component';

const FR_TRANSLATIONS = {
  whiteboard: {
    card: {
      editText: 'Modifier le texte',
      editLabel: "Modifier l'étiquette",
      imageAlt: 'Image de la carte',
      locked: 'Carte verrouillée',
      editing: '{{name}} modifie…',
      connect: 'Relier depuis cette carte',
      link: {
        previewAlt: 'Aperçu du lien',
      },
      resizeHandle: 'Redimensionner la carte',
      text: { contentAriaLabel: 'Contenu du pense-bête' },
    },
  },
};

function makeLinkCard(overrides: Partial<Card> = {}): Card {
  return {
    id: 'card-1',
    boardId: 'board-1',
    type: 'LINK',
    content: 'https://example.com/article',
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

function makeTextCard(overrides: Partial<Card> = {}): Card {
  return {
    id: 'card-1',
    boardId: 'board-1',
    type: 'TEXT',
    content: 'hello world',
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
    ...overrides,
  };
}

describe('BoardCardComponent — LINK type (US08.6.5)', () => {
  let fixture: ComponentFixture<BoardCardComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [
        BoardCardComponent,
        TranslocoTestingModule.forRoot({
          langs: { fr: FR_TRANSLATIONS },
          translocoConfig: { defaultLang: 'fr', availableLangs: ['fr'] },
          preloadLangs: true,
        }),
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(BoardCardComponent);
  });

  afterEach(() => {
    fixture.destroy();
  });

  function setCard(card: Card): void {
    fixture.componentRef.setInput('card', card);
    fixture.detectChanges();
  }

  it('renders the raw URL, as an accessible link, before enrichment (meta = null)', () => {
    setCard(makeLinkCard({ content: 'https://example.com/raw', meta: null }));
    const anchor = fixture.nativeElement.querySelector('a.wb-card__link') as HTMLAnchorElement;
    expect(anchor).toBeTruthy();
    expect(anchor.getAttribute('href')).toBe('https://example.com/raw');
    expect(anchor.getAttribute('aria-label')).toBe('https://example.com/raw');
    expect(fixture.nativeElement.querySelector('.wb-card__link-title')?.textContent?.trim()).toBe(
      'https://example.com/raw',
    );
    // No loading state that traps focus — no image, no spinner, just the raw URL text.
    expect(fixture.nativeElement.querySelector('.wb-card__link-image')).toBeNull();
  });

  it('renders the full OpenGraph preview once meta arrives (card:meta_updated)', () => {
    setCard(
      makeLinkCard({
        meta: {
          title: 'Example Article',
          description: 'A short summary of the article.',
          image: 'https://cdn.example.com/preview.png',
          siteName: 'Example News',
        },
      }),
    );
    const anchor = fixture.nativeElement.querySelector('a.wb-card__link') as HTMLAnchorElement;
    expect(anchor.getAttribute('aria-label')).toBe('Example Article');
    expect(fixture.nativeElement.querySelector('.wb-card__link-title')?.textContent?.trim()).toBe(
      'Example Article',
    );
    expect(fixture.nativeElement.querySelector('.wb-card__link-description')?.textContent?.trim()).toBe(
      'A short summary of the article.',
    );
    expect(fixture.nativeElement.querySelector('.wb-card__link-sitename')?.textContent?.trim()).toBe(
      'Example News',
    );
    const img = fixture.nativeElement.querySelector('.wb-card__link-image') as HTMLImageElement;
    expect(img).toBeTruthy();
    expect(img.getAttribute('src')).toBe('https://cdn.example.com/preview.png');
    expect(img.getAttribute('alt')).toBe('Example Article');
  });

  it('disappears the preview back to the raw-URL state when meta is reset to null', () => {
    setCard(makeLinkCard({ meta: { title: 'Cached title' } }));
    expect(fixture.nativeElement.querySelector('.wb-card__link-title')?.textContent?.trim()).toBe(
      'Cached title',
    );
    setCard(makeLinkCard({ meta: null }));
    expect(fixture.nativeElement.querySelector('.wb-card__link-title')?.textContent?.trim()).toBe(
      'https://example.com/article',
    );
  });

  it('sanitises meta at render: a non-http(s) image URL is never bound as an <img src>', () => {
    setCard(makeLinkCard({ meta: { title: 'Sneaky', image: 'javascript:alert(1)' } }));
    expect(fixture.nativeElement.querySelector('.wb-card__link-image')).toBeNull();
  });

  it('sanitises meta at render: HTML-ish title text is shown as literal text, never executed', () => {
    setCard(makeLinkCard({ meta: { title: '<img src=x onerror=alert(1)>' } }));
    const titleEl = fixture.nativeElement.querySelector('.wb-card__link-title') as HTMLElement;
    expect(titleEl.textContent?.trim()).toBe('<img src=x onerror=alert(1)>');
    expect(titleEl.querySelector('img')).toBeNull();
  });

  it('falls back to an inert (no href) anchor when content is somehow not a safe URL', () => {
    setCard(makeLinkCard({ content: 'javascript:alert(1)', meta: null }));
    const anchor = fixture.nativeElement.querySelector('a.wb-card__link') as HTMLAnchorElement;
    expect(anchor.hasAttribute('href')).toBe(false);
  });

  it('uses the site name as image alt fallback when no title is present', () => {
    setCard(makeLinkCard({ meta: { image: 'https://cdn.example.com/a.png', siteName: 'Example Site' } }));
    const img = fixture.nativeElement.querySelector('.wb-card__link-image') as HTMLImageElement;
    expect(img.getAttribute('alt')).toBe('Example Site');
  });

  it('uses the translated generic fallback for image alt when neither title nor site name is present', () => {
    setCard(makeLinkCard({ meta: { image: 'https://cdn.example.com/a.png' } }));
    const img = fixture.nativeElement.querySelector('.wb-card__link-image') as HTMLImageElement;
    expect(img.getAttribute('alt')).toBe('Aperçu du lien');
  });

  it('opens the card-detail modal on double-click rather than entering inline text edit', () => {
    setCard(makeLinkCard());
    let emittedId: string | null = null;
    fixture.componentInstance.openDetail.subscribe((id: string) => (emittedId = id));
    const body = fixture.nativeElement.querySelector('.wb-card__body') as HTMLElement;
    body.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    fixture.detectChanges();
    expect(emittedId).toBe('card-1');
    expect(fixture.nativeElement.querySelector('textarea')).toBeNull();
  });
});

describe('BoardCardComponent — US08.6.1 TEXT card', () => {
  let fixture: ComponentFixture<BoardCardComponent>;

  async function create(inputs: { card: Card; selected?: boolean; readOnly?: boolean }): Promise<void> {
    await TestBed.configureTestingModule({
      imports: [
        BoardCardComponent,
        TranslocoTestingModule.forRoot({
          langs: { fr: FR_TRANSLATIONS },
          translocoConfig: { defaultLang: 'fr', availableLangs: ['fr'] },
          preloadLangs: true,
        }),
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(BoardCardComponent);
    fixture.componentRef.setInput('card', inputs.card);
    if (inputs.selected !== undefined) {
      fixture.componentRef.setInput('selected', inputs.selected);
    }
    if (inputs.readOnly !== undefined) {
      fixture.componentRef.setInput('readOnly', inputs.readOnly);
    }
    fixture.detectChanges();
  }

  afterEach(() => fixture?.destroy());

  it('renders a TEXT card\'s content with its background colour', async () => {
    await create({ card: makeTextCard({ content: 'a sticky note', color: '#FEF08A' }) });
    const body = fixture.nativeElement.querySelector('.wb-card__body') as HTMLElement;
    const text = fixture.nativeElement.querySelector('.wb-card__text') as HTMLElement;
    expect(text.textContent?.trim()).toBe('a sticky note');
    expect(body.style.background).toBe('rgb(254, 240, 138)');
  });

  it('is keyboard-focusable', async () => {
    await create({ card: makeTextCard() });
    expect(fixture.nativeElement.getAttribute('tabindex')).toBe('0');
  });

  it('opens inline edit on dblclick', async () => {
    await create({ card: makeTextCard() });
    fixture.nativeElement.querySelector('.wb-card__body').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    fixture.detectChanges();
    const textarea = fixture.nativeElement.querySelector('.wb-card__edit') as HTMLTextAreaElement;
    expect(textarea).toBeTruthy();
    expect(textarea.getAttribute('aria-label')).toBe('Contenu du pense-bête');
  });

  it('opens inline edit on Enter while the card host has focus (A11y AC)', async () => {
    await create({ card: makeTextCard() });
    const host = fixture.nativeElement as HTMLElement;
    host.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.wb-card__edit')).toBeTruthy();
  });

  it('opens inline edit on F2 while the card host has focus (A11y AC)', async () => {
    await create({ card: makeTextCard() });
    const host = fixture.nativeElement as HTMLElement;
    host.dispatchEvent(new KeyboardEvent('keydown', { key: 'F2', bubbles: true }));
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.wb-card__edit')).toBeTruthy();
  });

  it('does not open inline edit on Enter when read-only', async () => {
    await create({ card: makeTextCard(), readOnly: true });
    const host = fixture.nativeElement as HTMLElement;
    host.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.wb-card__edit')).toBeNull();
  });

  it('commits edited content on blur and emits contentCommit', async () => {
    await create({ card: makeTextCard({ content: 'original' }) });
    fixture.nativeElement.querySelector('.wb-card__body').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    fixture.detectChanges();

    let emitted: string | undefined;
    fixture.componentInstance.contentCommit.subscribe((v: string) => (emitted = v));

    const textarea = fixture.nativeElement.querySelector('.wb-card__edit') as HTMLTextAreaElement;
    textarea.value = 'edited';
    textarea.dispatchEvent(new Event('input'));
    textarea.dispatchEvent(new FocusEvent('blur'));
    fixture.detectChanges();

    expect(emitted).toBe('edited');
  });

  it('falls back to an accessible ink colour for default-styled text on a dark background', async () => {
    // #111827 (near-black) is a valid TEXT card background swatch — default ink (#1f2937) would
    // be dark-on-dark; the accessible override must kick in (US08.6.1 A11y AC, ≥ 4.5:1).
    await create({ card: makeTextCard({ color: '#111827', content: 'dark bg' }) });
    const text = fixture.nativeElement.querySelector('.wb-card__text') as HTMLElement;
    expect(text.style.color).toBe('rgb(255, 255, 255)');
  });

  it('keeps the default ink colour on a light background', async () => {
    await create({ card: makeTextCard({ color: '#FFEB3B', content: 'light bg' }) });
    const text = fixture.nativeElement.querySelector('.wb-card__text') as HTMLElement;
    expect(text.style.color).toBe('rgb(31, 41, 55)'); // #1f2937
  });

  it('hides resize handles entirely when the card is locked, even while selected', async () => {
    await create({ card: makeTextCard({ locked: true }), selected: true });
    expect(fixture.nativeElement.querySelectorAll('[data-resize-dir]').length).toBe(0);
  });

  it('shows keyboard-reachable resize handles when selected and unlocked', async () => {
    await create({ card: makeTextCard({ locked: false }), selected: true });
    const handles = fixture.nativeElement.querySelectorAll('[data-resize-dir]');
    expect(handles.length).toBe(8);
    handles.forEach((h: HTMLElement) => {
      expect(h.getAttribute('tabindex')).toBe('0');
      expect(h.getAttribute('aria-label')).toBe('Redimensionner la carte');
    });
  });

  it('shows the lock indicator for a locked card', async () => {
    await create({ card: makeTextCard({ locked: true }) });
    expect(fixture.nativeElement.querySelector('.wb-card__lock')).toBeTruthy();
  });
});
