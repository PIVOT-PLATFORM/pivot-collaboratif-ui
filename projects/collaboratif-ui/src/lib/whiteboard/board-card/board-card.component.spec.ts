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
