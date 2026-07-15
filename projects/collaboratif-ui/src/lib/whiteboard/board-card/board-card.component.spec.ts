import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslocoTestingModule } from '@jsverse/transloco';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Card } from '../model/board.types';
import { serializeTable } from '../model/table';
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

/**
 * Tests for US08.6.2 (LABEL card) rendered through the shared {@link BoardCardComponent}:
 * compact rendering (no post-it background, distinct from TEXT), inline edit round-trip via
 * the LABEL-specific format codec, and the A11y contract (focusable, Enter/F2 to edit, an
 * explicit "Étiquette" aria-label, WCAG AA contrast of the default label colour against the
 * canvas background).
 */

function makeLabelCard(overrides: Partial<Card> = {}): Card {
  return {
    id: 'card-1',
    boardId: 'board-1',
    type: 'LABEL',
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
    ...overrides,
  };
}

/** Relative luminance + contrast ratio per WCAG 2.1 — local helper (no shared export exists yet). */
function relativeLuminance(hex: string): number {
  const c = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(c.slice(i, i + 2), 16) / 255);
  const lin = (v: number) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}
function contrastRatio(hexA: string, hexB: string): number {
  const la = relativeLuminance(hexA) + 0.05;
  const lb = relativeLuminance(hexB) + 0.05;
  return la > lb ? la / lb : lb / la;
}

describe('BoardCardComponent — LABEL (US08.6.2)', () => {
  let fixture: ComponentFixture<BoardCardComponent>;
  let component: BoardCardComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [
        BoardCardComponent,
        TranslocoTestingModule.forRoot({
          langs: { fr: {}, en: {} },
          translocoConfig: { defaultLang: 'fr', availableLangs: ['fr', 'en'] },
          preloadLangs: true,
        }),
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(BoardCardComponent);
    component = fixture.componentInstance;
  });

  function setCard(overrides: Partial<Card> = {}): void {
    fixture.componentRef.setInput('card', makeLabelCard(overrides));
    fixture.detectChanges();
  }

  // ── Rendering: compact, no post-it background, distinct from TEXT ──────────────

  it('renders the LABEL content as compact text, not a post-it', () => {
    setCard({ content: 'Sprint 12' });
    const body = fixture.nativeElement.querySelector('.wb-card__body');
    const label = fixture.nativeElement.querySelector('.wb-card__label');
    expect(label).not.toBeNull();
    expect(label.textContent).toContain('Sprint 12');
    // The post-it background is only ever applied for TEXT — never for LABEL.
    expect(body.style.background).toBe('');
  });

  it('applies the post-it background for TEXT but not for LABEL — visual distinction', () => {
    setCard({ type: 'TEXT', content: 'note', color: '#FFEB3B' });
    const textBody = fixture.nativeElement.querySelector('.wb-card__body');
    // jsdom normalizes a hex colour assigned via [style.background] to rgb().
    expect(textBody.style.background).toBe('rgb(255, 235, 59)');

    setCard({ type: 'LABEL', content: 'note', color: '#FFEB3B' });
    const labelBody = fixture.nativeElement.querySelector('.wb-card__body');
    expect(labelBody.style.background).toBe('');
    expect(fixture.nativeElement.querySelector('.wb-card__text')).toBeNull();
    expect(fixture.nativeElement.querySelector('.wb-card__label')).not.toBeNull();
  });

  it('an empty LABEL renders (no server-side minimum length) and stays editable at double-click', () => {
    setCard({ content: '' });
    expect(fixture.nativeElement.querySelector('.wb-card__label').textContent.trim()).toBe('');
    component['onDoubleClick']();
    fixture.detectChanges();
    expect(component['editing']()).toBe(true);
  });

  // ── Inline edit round-trip — LABEL uses its own format codec, distinct from TEXT ───

  it('double-click starts inline edit with the LABEL plain text pre-filled', () => {
    setCard({ content: 'Étiquette existante' });
    component['onDoubleClick']();
    fixture.detectChanges();
    expect(component['editing']()).toBe(true);
    expect(component['editValue']()).toBe('Étiquette existante');
    const textarea = fixture.nativeElement.querySelector('.wb-card__edit--label');
    expect(textarea).not.toBeNull();
  });

  it('commits edited text through the LABEL serializer, emitting contentCommit', () => {
    setCard({ content: 'before' });
    let committed: string | undefined;
    component.contentCommit.subscribe((v) => (committed = v));
    component['onDoubleClick']();
    component['editValue'].set('after');
    component['commitEdit']();
    expect(committed).toBe('after');
  });

  it('committing an unchanged value does not emit contentCommit', () => {
    setCard({ content: 'same' });
    let emitted = false;
    component.contentCommit.subscribe(() => (emitted = true));
    component['onDoubleClick']();
    component['commitEdit']();
    expect(emitted).toBe(false);
  });

  // ── A11y: focusable, Enter/F2 to edit, explicit aria-label ──────────────────────

  it('the LABEL host is focusable (tabindex=0)', () => {
    setCard();
    expect(fixture.nativeElement.getAttribute('tabindex')).toBe('0');
  });

  it('the LABEL host carries an explicit, translated aria-label ("Étiquette")', () => {
    setCard();
    expect(fixture.nativeElement.getAttribute('aria-label')).toBeTruthy();
    expect(component['hostAriaLabel']()).toBe('whiteboard.card.label.ariaLabel');
  });

  it('a non-textual card type (SHAPE) gets no host aria-label and is not made focusable', () => {
    setCard({ type: 'SHAPE', content: '{}' });
    expect(fixture.nativeElement.getAttribute('aria-label')).toBeNull();
    expect(fixture.nativeElement.getAttribute('tabindex')).toBeNull();
  });

  // The four tests below dispatch a real event on the host element (bubbles: true) rather
  // than calling `onHostKeydown` directly — the handler now also checks `event.target ===
  // this.host.nativeElement` (merged in from US08.6.1, guards against a keydown bubbling up
  // from a focused resize handle re-triggering edit mode), which a directly-constructed,
  // never-dispatched KeyboardEvent would fail (its `target` is `null`).

  it('Enter on the focused, non-editing host opens inline edit', () => {
    setCard({ content: 'x' });
    expect(component['editing']()).toBe(false);
    fixture.nativeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(component['editing']()).toBe(true);
  });

  it('F2 on the focused, non-editing host opens inline edit', () => {
    setCard({ content: 'x' });
    fixture.nativeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'F2', bubbles: true }));
    expect(component['editing']()).toBe(true);
  });

  it('a key other than Enter/F2 on the host does not open inline edit', () => {
    setCard({ content: 'x' });
    fixture.nativeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
    expect(component['editing']()).toBe(false);
  });

  it('Enter is ignored on the host while read-only', () => {
    fixture.componentRef.setInput('readOnly', true);
    setCard({ content: 'x' });
    fixture.nativeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(component['editing']()).toBe(false);
  });

  it('pressing Enter inside the edit textarea commits and does not immediately reopen edit mode', () => {
    // Regression guard: onEditKeydown must stop propagation, otherwise the same keydown
    // would bubble to the host's own listener right after `editing` flips back to false,
    // instantly reopening edit mode.
    setCard({ content: 'before' });
    component['onDoubleClick']();
    component['editValue'].set('after');
    const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    component['onEditKeydown'](event);
    expect(component['editing']()).toBe(false);
  });

  // ── Contrast: default LABEL text colour vs the canvas background (WCAG AA ≥ 4.5:1) ──

  it('the default LABEL text colour passes WCAG AA against the canvas background (#fafafa)', () => {
    setCard({ content: 'x' });
    const defaultLabelColor = component['labelFmt']().color;
    expect(contrastRatio(defaultLabelColor, '#fafafa')).toBeGreaterThanOrEqual(4.5);
  });
});

/**
 * Tests for US08.6.3 (SHAPE card) rendered through the shared {@link BoardCardComponent}:
 * rendering of the whitelisted shape kinds, the A11y contract (`role="img"` + a translated
 * `aria-label` describing the shape's nature), resize handles hidden when locked, and visual
 * distinction from TEXT/LABEL.
 */

function makeShapeCard(overrides: Partial<Card> = {}): Card {
  return {
    id: 'card-1',
    boardId: 'board-1',
    type: 'SHAPE',
    content: 'rect|#A5B4FC|none|1|0',
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

describe('BoardCardComponent — SHAPE (US08.6.3)', () => {
  let fixture: ComponentFixture<BoardCardComponent>;
  let component: BoardCardComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [
        BoardCardComponent,
        TranslocoTestingModule.forRoot({
          langs: {
            fr: {
              whiteboard: {
                card: {
                  shape: {
                    ariaLabel: 'Forme : {{kind}}',
                    kind: {
                      rect: 'rectangle',
                      circle: 'ellipse',
                      diamond: 'diamant',
                      triangle: 'triangle',
                      line: 'ligne',
                      star: 'étoile',
                    },
                  },
                },
              },
            },
            en: {},
          },
          translocoConfig: { defaultLang: 'fr', availableLangs: ['fr', 'en'] },
          preloadLangs: true,
        }),
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(BoardCardComponent);
    component = fixture.componentInstance;
  });

  function setCard(overrides: Partial<Card> = {}): void {
    fixture.componentRef.setInput('card', makeShapeCard(overrides));
    fixture.detectChanges();
  }

  // ── Rendering: whitelisted kinds ────────────────────────────────────────────────

  it('renders a rect SHAPE as the default (@default) svg case', () => {
    setCard({ content: 'rect|#112233|none|1|0' });
    const rect = fixture.nativeElement.querySelector('.wb-card__svg rect');
    expect(rect).not.toBeNull();
    expect(rect.getAttribute('stroke')).toBe('#112233');
  });

  it('renders a circle SHAPE as an ellipse element', () => {
    setCard({ content: 'circle|#445566|#778899|1|0' });
    const ellipse = fixture.nativeElement.querySelector('.wb-card__svg ellipse');
    expect(ellipse).not.toBeNull();
    expect(ellipse.getAttribute('fill')).toBe('#778899');
  });

  it('renders "none" fill as SVG fill="none" (outline only)', () => {
    setCard({ content: 'rect|#112233|none|1|0' });
    const rect = fixture.nativeElement.querySelector('.wb-card__svg rect');
    expect(rect.getAttribute('fill')).toBe('none');
  });

  // ── A11y: role="img" + translated aria-label describing the shape's nature ─────

  it('the SHAPE svg carries role="img" and a translated aria-label naming the kind', () => {
    setCard({ content: 'circle|#112233|none|1|0' });
    const svg = fixture.nativeElement.querySelector('.wb-card__svg');
    expect(svg.getAttribute('role')).toBe('img');
    expect(svg.getAttribute('aria-label')).toBe('Forme : ellipse');
  });

  it('a rect SHAPE gets the "rectangle" aria-label', () => {
    setCard({ content: 'rect|#112233|none|1|0' });
    expect(component['shapeAriaLabel']()).toBe('Forme : rectangle');
  });

  it('a non-SHAPE card has no shapeAriaLabel', () => {
    setCard({ type: 'TEXT', content: 'hello' });
    expect(component['shapeAriaLabel']()).toBeNull();
  });

  // ── Resize handles hidden when locked ────────────────────────────────────────────

  it('shows resize handles for a selected, unlocked SHAPE', () => {
    fixture.componentRef.setInput('selected', true);
    setCard({ locked: false });
    expect(fixture.nativeElement.querySelectorAll('.wb-card__resize').length).toBeGreaterThan(0);
  });

  it('hides resize handles for a selected but locked SHAPE (A11y AC)', () => {
    fixture.componentRef.setInput('selected', true);
    setCard({ locked: true });
    expect(fixture.nativeElement.querySelectorAll('.wb-card__resize').length).toBe(0);
  });

  // ── Visual distinction from TEXT/LABEL ──────────────────────────────────────────

  it('a SHAPE card renders no textarea/text/label content, distinct from TEXT/LABEL', () => {
    setCard();
    expect(fixture.nativeElement.querySelector('.wb-card__text')).toBeNull();
    expect(fixture.nativeElement.querySelector('.wb-card__label')).toBeNull();
    expect(fixture.nativeElement.querySelector('.wb-card__svg')).not.toBeNull();
  });

  it('double-click on a SHAPE opens the detail modal, not inline edit (unlike TEXT/LABEL)', () => {
    setCard();
    let opened: string | undefined;
    component.openDetail.subscribe((id) => (opened = id));
    component['onDoubleClick']();
    expect(opened).toBe('card-1');
    expect(component['editing']()).toBe(false);
  });
});

const TABLE_FR_TRANSLATIONS = {
  whiteboard: {
    card: {
      editText: 'Modifier le texte',
      editLabel: "Modifier l'étiquette",
      imageAlt: 'Image de la carte',
      locked: 'Carte verrouillée',
      editing: '{{name}} modifie…',
      connect: 'Relier depuis cette carte',
      table: {
        aria: 'Tableau',
        editCell: 'Modifier la cellule',
      },
    },
  },
};

function tableCard(rows: string[][], overrides: Partial<Card> = {}): Card {
  return {
    id: 'card-1',
    boardId: 'board-1',
    type: 'TABLE',
    content: serializeTable(rows),
    meta: null,
    posX: 0,
    posY: 0,
    width: 240,
    height: 140,
    color: '#FFFFFF',
    groupId: null,
    groupColor: null,
    locked: false,
    layer: 1,
    fieldValues: [],
    ...overrides,
  };
}

describe('BoardCardComponent — TABLE type (US08.6.6)', () => {
  let fixture: ComponentFixture<BoardCardComponent>;

  async function render(card: Card): Promise<void> {
    await TestBed.configureTestingModule({
      imports: [
        BoardCardComponent,
        TranslocoTestingModule.forRoot({
          langs: { fr: TABLE_FR_TRANSLATIONS },
          translocoConfig: { defaultLang: 'fr', availableLangs: ['fr'] },
          preloadLangs: true,
        }),
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(BoardCardComponent);
    fixture.componentRef.setInput('card', card);
    fixture.detectChanges();
  }

  function table(): HTMLTableElement {
    return fixture.nativeElement.querySelector('.wb-card__table');
  }

  function cellAt(r: number, c: number): HTMLElement {
    return fixture.nativeElement.querySelector(`[data-row="${r}"][data-col="${c}"]`);
  }

  // ── A11y ──

  it('renders a native <table> with role="table" and an aria-label', async () => {
    await render(tableCard([['a', 'b']]));

    const el = table();
    expect(el.tagName).toBe('TABLE');
    expect(el.getAttribute('role')).toBe('table');
    expect(el.getAttribute('aria-label')).toBe('Tableau');
  });

  it('renders the first row as column headers (<th scope="col">)', async () => {
    await render(tableCard([['h1', 'h2'], ['v1', 'v2']]));

    const headers = fixture.nativeElement.querySelectorAll('th');
    expect(headers).toHaveLength(2);
    expect(headers[0].getAttribute('scope')).toBe('col');
    expect(headers[0].textContent?.trim()).toBe('h1');
  });

  it('every cell is keyboard-focusable (tabindex="0")', async () => {
    await render(tableCard([['a', 'b'], ['c', 'd']]));

    expect(cellAt(0, 0).getAttribute('tabindex')).toBe('0');
    expect(cellAt(1, 1).getAttribute('tabindex')).toBe('0');
  });

  it('renders cell text via interpolation, never as markup (XSS safety)', async () => {
    await render(tableCard([['<img src=x onerror=alert(1)>', 'safe']]));

    expect(fixture.nativeElement.querySelector('img[src="x"]')).toBeNull();
    expect(cellAt(0, 0).textContent).toContain('<img src=x onerror=alert(1)>');
  });

  // ── Cell edit (F2/Enter to edit, Enter/blur to commit, Escape to cancel) ──

  it('F2 on a focused cell opens inline edit with an aria-labelled input', async () => {
    await render(tableCard([['h1'], ['a']]));

    cellAt(1, 0).dispatchEvent(new KeyboardEvent('keydown', { key: 'F2', bubbles: true }));
    fixture.detectChanges();

    const input = fixture.nativeElement.querySelector('.wb-card__table-cell-input');
    expect(input).not.toBeNull();
    expect(input.getAttribute('aria-label')).toBe('Modifier la cellule');
    expect(input.value).toBe('a');
  });

  it('commits the edited cell value via contentCommit, preserving other cells', async () => {
    await render(tableCard([['h1', 'h2'], ['a', 'b']]));
    const emitted: string[] = [];
    fixture.componentInstance.contentCommit.subscribe((v: string) => emitted.push(v));

    cellAt(1, 0).dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    fixture.detectChanges();
    const input: HTMLInputElement = fixture.nativeElement.querySelector('.wb-card__table-cell-input');
    input.value = 'edited';
    input.dispatchEvent(new Event('input'));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    fixture.detectChanges();

    expect(emitted).toHaveLength(1);
    expect(JSON.parse(emitted[0]).rows).toEqual([
      ['h1', 'h2'],
      ['edited', 'b'],
    ]);
  });

  it('Escape cancels the edit without emitting contentCommit', async () => {
    await render(tableCard([['h1'], ['a']]));
    const emitted: string[] = [];
    fixture.componentInstance.contentCommit.subscribe((v: string) => emitted.push(v));

    cellAt(1, 0).dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    fixture.detectChanges();
    const input: HTMLInputElement = fixture.nativeElement.querySelector('.wb-card__table-cell-input');
    input.value = 'discarded';
    input.dispatchEvent(new Event('input'));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    fixture.detectChanges();

    expect(emitted).toHaveLength(0);
    expect(fixture.nativeElement.querySelector('.wb-card__table-cell-input')).toBeNull();
  });

  it('does not open inline edit on a read-only (VIEWER) board', async () => {
    await render(tableCard([['h1'], ['a']]));
    fixture.componentRef.setInput('readOnly', true);
    fixture.detectChanges();

    cellAt(1, 0).dispatchEvent(new KeyboardEvent('keydown', { key: 'F2', bubbles: true }));
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.wb-card__table-cell-input')).toBeNull();
  });

  it('does not open inline edit on a locked card', async () => {
    await render(tableCard([['h1'], ['a']], { locked: true }));

    cellAt(1, 0).dispatchEvent(new KeyboardEvent('keydown', { key: 'F2', bubbles: true }));
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.wb-card__table-cell-input')).toBeNull();
  });
});
