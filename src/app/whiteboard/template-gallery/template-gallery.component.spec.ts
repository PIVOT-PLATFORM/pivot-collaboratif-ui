import { ComponentFixture, TestBed } from '@angular/core/testing';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { TranslocoTestingModule } from '@jsverse/transloco';
import { TemplateGalleryComponent } from './template-gallery.component';
import { WhiteboardTemplate } from '../../core/whiteboard/board.model';
import { environment } from '../../../environments/environment';

const BASE = `${environment.apiUrl}/whiteboard/templates`;

const FR_TRANSLATIONS = {
  whiteboard: {
    template: {
      gallery: {
        label: 'Modèle de tableau',
        loadError: 'Impossible de charger les modèles de tableau.',
        retry: 'Réessayer',
      },
      previewAlt: 'Aperçu du modèle {{name}}',
      brainstorm: { name: 'Brainstorm', description: 'Idées libres sur des post-its.' },
      retrospective: { name: 'Rétrospective', description: 'Ce qui a bien fonctionné, ce qui peut s\'améliorer.' },
      userStoryMap: { name: 'User Story Map', description: 'Parcours utilisateur et priorisation.' },
    },
  },
};

function makeTemplates(): WhiteboardTemplate[] {
  return [
    { id: 'tpl-retro', code: 'RETROSPECTIVE', previewUrl: 'https://cdn.example.com/retro.png' },
    { id: 'tpl-brainstorm', code: 'BRAINSTORM', previewUrl: 'https://cdn.example.com/brainstorm.png' },
    { id: 'tpl-usm', code: 'USER_STORY_MAP', previewUrl: 'https://cdn.example.com/usm.png' },
  ];
}

describe('TemplateGalleryComponent', () => {
  let fixture: ComponentFixture<TemplateGalleryComponent>;
  let httpMock: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [
        TemplateGalleryComponent,
        TranslocoTestingModule.forRoot({
          langs: { fr: FR_TRANSLATIONS },
          translocoConfig: { defaultLang: 'fr', availableLangs: ['fr'] },
          preloadLangs: true,
        }),
      ],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();

    fixture = TestBed.createComponent(TemplateGalleryComponent);
    httpMock = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
  });

  afterEach(() => {
    httpMock.verify();
    TestBed.resetTestingModule();
  });

  it('shows skeleton cards with aria-busy while loading', () => {
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('[aria-busy="true"]')).toBeTruthy();
    expect(el.querySelectorAll('.template-gallery__skeleton').length).toBe(3);
    httpMock.expectOne(BASE).flush(makeTemplates());
  });

  it('renders cards with name, description and descriptive alt after successful load', () => {
    httpMock.expectOne(BASE).flush(makeTemplates());
    fixture.detectChanges();

    const el: HTMLElement = fixture.nativeElement;
    const cards = el.querySelectorAll('.template-gallery__card');
    expect(cards.length).toBe(3);
    expect(el.textContent).toContain('Brainstorm');
    expect(el.textContent).toContain('Rétrospective');
    expect(el.textContent).toContain('User Story Map');

    const brainstormImg = Array.from(el.querySelectorAll<HTMLImageElement>('.template-gallery__preview'))
      .find(img => img.alt.includes('Brainstorm'));
    expect(brainstormImg).toBeTruthy();
    expect(brainstormImg?.alt).toBe('Aperçu du modèle Brainstorm');
  });

  it('selects "Brainstorm" by default and marks it aria-selected', () => {
    httpMock.expectOne(BASE).flush(makeTemplates());
    fixture.detectChanges();

    const el: HTMLElement = fixture.nativeElement;
    const cards = Array.from(el.querySelectorAll<HTMLButtonElement>('.template-gallery__card'));
    const brainstormCard = cards.find(c => c.textContent?.includes('Brainstorm'));
    expect(brainstormCard?.getAttribute('aria-selected')).toBe('true');
    expect(brainstormCard?.tabIndex).toBe(0);

    const others = cards.filter(c => c !== brainstormCard);
    others.forEach(c => {
      expect(c.getAttribute('aria-selected')).toBe('false');
      expect(c.tabIndex).toBe(-1);
    });
  });

  it('falls back to the first template when Brainstorm is absent from the list', () => {
    const templates = makeTemplates().filter(t => t.code !== 'BRAINSTORM');
    httpMock.expectOne(BASE).flush(templates);
    fixture.detectChanges();

    const el: HTMLElement = fixture.nativeElement;
    const firstCard = el.querySelector('.template-gallery__card') as HTMLButtonElement;
    expect(firstCard.getAttribute('aria-selected')).toBe('true');
  });

  it('emits selectionChange with the default template id once loaded', () => {
    const emitted: (string | null)[] = [];
    fixture.componentInstance.selectionChange.subscribe(id => emitted.push(id));

    httpMock.expectOne(BASE).flush(makeTemplates());
    fixture.detectChanges();

    expect(emitted).toEqual(['tpl-brainstorm']);
  });

  it('clicking a card selects it and emits its id', () => {
    const emitted: (string | null)[] = [];
    httpMock.expectOne(BASE).flush(makeTemplates());
    fixture.detectChanges();
    fixture.componentInstance.selectionChange.subscribe(id => emitted.push(id));

    const el: HTMLElement = fixture.nativeElement;
    const cards = Array.from(el.querySelectorAll<HTMLButtonElement>('.template-gallery__card'));
    const retroCard = cards.find(c => c.textContent?.includes('Rétrospective'))!;
    retroCard.click();
    fixture.detectChanges();

    expect(emitted).toEqual(['tpl-retro']);
    expect(retroCard.getAttribute('aria-selected')).toBe('true');
  });

  it('ArrowRight moves DOM focus to the next card without changing selection', () => {
    httpMock.expectOne(BASE).flush(makeTemplates());
    fixture.detectChanges();

    const el: HTMLElement = fixture.nativeElement;
    const cards = Array.from(el.querySelectorAll<HTMLButtonElement>('.template-gallery__card'));
    const focusSpy = vi.spyOn(cards[1], 'focus');

    cards[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
    fixture.detectChanges();

    expect(focusSpy).toHaveBeenCalled();
  });

  it('ArrowLeft wraps focus to the last card from the first one', () => {
    httpMock.expectOne(BASE).flush(makeTemplates());
    fixture.detectChanges();

    const el: HTMLElement = fixture.nativeElement;
    const cards = Array.from(el.querySelectorAll<HTMLButtonElement>('.template-gallery__card'));
    const focusSpy = vi.spyOn(cards[cards.length - 1], 'focus');

    cards[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true }));
    fixture.detectChanges();

    expect(focusSpy).toHaveBeenCalled();
  });

  it('Enter key selects the focused card', () => {
    const emitted: (string | null)[] = [];
    httpMock.expectOne(BASE).flush(makeTemplates());
    fixture.detectChanges();
    fixture.componentInstance.selectionChange.subscribe(id => emitted.push(id));

    const el: HTMLElement = fixture.nativeElement;
    const cards = Array.from(el.querySelectorAll<HTMLButtonElement>('.template-gallery__card'));
    const usmIndex = cards.findIndex(c => c.textContent?.includes('User Story Map'));
    cards[usmIndex].dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    fixture.detectChanges();

    expect(emitted).toEqual(['tpl-usm']);
  });

  it('Space key selects the focused card', () => {
    const emitted: (string | null)[] = [];
    httpMock.expectOne(BASE).flush(makeTemplates());
    fixture.detectChanges();
    fixture.componentInstance.selectionChange.subscribe(id => emitted.push(id));

    const el: HTMLElement = fixture.nativeElement;
    const cards = Array.from(el.querySelectorAll<HTMLButtonElement>('.template-gallery__card'));
    // cards[0] is the "Rétrospective" card (tpl-retro) — see makeTemplates() ordering.
    cards[0].dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }));
    fixture.detectChanges();

    expect(emitted).toEqual(['tpl-retro']);
    expect(cards[0].getAttribute('aria-selected')).toBe('true');
  });

  it('Home key moves focus to the first card, End key to the last', () => {
    httpMock.expectOne(BASE).flush(makeTemplates());
    fixture.detectChanges();

    const el: HTMLElement = fixture.nativeElement;
    const cards = Array.from(el.querySelectorAll<HTMLButtonElement>('.template-gallery__card'));
    const lastFocusSpy = vi.spyOn(cards[cards.length - 1], 'focus');
    const firstFocusSpy = vi.spyOn(cards[0], 'focus');

    cards[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true, cancelable: true }));
    fixture.detectChanges();
    expect(lastFocusSpy).toHaveBeenCalled();

    cards[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true, cancelable: true }));
    fixture.detectChanges();
    expect(firstFocusSpy).toHaveBeenCalled();
  });

  it('ignores unrelated keys without moving focus or changing selection', () => {
    const emitted: (string | null)[] = [];
    httpMock.expectOne(BASE).flush(makeTemplates());
    fixture.detectChanges();
    fixture.componentInstance.selectionChange.subscribe(id => emitted.push(id));

    const el: HTMLElement = fixture.nativeElement;
    const cards = Array.from(el.querySelectorAll<HTMLButtonElement>('.template-gallery__card'));
    cards[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
    fixture.detectChanges();

    expect(emitted).toEqual([]);
  });

  it('falls back to blank selection when the backend returns an empty template list', () => {
    const emitted: (string | null)[] = [];
    fixture.componentInstance.selectionChange.subscribe(id => emitted.push(id));

    httpMock.expectOne(BASE).flush([]);
    fixture.detectChanges();

    expect(emitted).toEqual([null]);
    expect(fixture.nativeElement.querySelectorAll('.template-gallery__card').length).toBe(0);
  });

  it('shows error state with role=alert and a retry button on HTTP failure', () => {
    httpMock.expectOne(BASE).flush('', { status: 500, statusText: 'Server Error' });
    fixture.detectChanges();

    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('[role="alert"]')).toBeTruthy();
    expect(el.querySelector('.template-gallery__retry-btn')).toBeTruthy();
    expect(el.querySelector('.template-gallery__grid[role="listbox"]')).toBeNull();
  });

  it('emits null selection when the template load fails (fallback to blank creation)', () => {
    const emitted: (string | null)[] = [];
    fixture.componentInstance.selectionChange.subscribe(id => emitted.push(id));

    httpMock.expectOne(BASE).flush('', { status: 500, statusText: 'Server Error' });
    fixture.detectChanges();

    expect(emitted).toEqual([null]);
  });

  it('retry button reloads templates and renders the gallery on success', () => {
    httpMock.expectOne(BASE).flush('', { status: 500, statusText: 'Server Error' });
    fixture.detectChanges();

    (fixture.nativeElement.querySelector('.template-gallery__retry-btn') as HTMLButtonElement).click();
    fixture.detectChanges();

    httpMock.expectOne(BASE).flush(makeTemplates());
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelectorAll('.template-gallery__card').length).toBe(3);
  });
});
