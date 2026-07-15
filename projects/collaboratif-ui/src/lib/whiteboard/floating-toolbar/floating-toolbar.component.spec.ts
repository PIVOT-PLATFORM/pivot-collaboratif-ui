import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslocoTestingModule } from '@jsverse/transloco';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { FloatingToolbarComponent } from './floating-toolbar.component';

/**
 * Tests for the floating toolbar's SHAPE fill colour picker (US08.6.3) — the second colour
 * picker (remplissage/fill) distinct from the pre-existing stroke `color` swatch group, shown
 * only while a SHAPE tool is active.
 */
describe('FloatingToolbarComponent — SHAPE fill picker (US08.6.3)', () => {
  let fixture: ComponentFixture<FloatingToolbarComponent>;
  let component: FloatingToolbarComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [
        FloatingToolbarComponent,
        TranslocoTestingModule.forRoot({
          langs: { fr: {}, en: {} },
          translocoConfig: { defaultLang: 'fr', availableLangs: ['fr', 'en'] },
          preloadLangs: true,
        }),
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(FloatingToolbarComponent);
    component = fixture.componentInstance;
  });

  function fillGroups(): NodeListOf<Element> {
    return fixture.nativeElement.querySelectorAll('.wb-toolbar__group--colors');
  }

  it('shows only the stroke colour group when a non-SHAPE tool is active', () => {
    fixture.componentRef.setInput('tool', 'select');
    fixture.detectChanges();
    expect(fillGroups().length).toBe(1);
  });

  it('shows a second (fill) colour group when a SHAPE tool is active', () => {
    fixture.componentRef.setInput('tool', 'rect');
    fixture.detectChanges();
    expect(fillGroups().length).toBe(2);
  });

  it('every SHAPE tool (rect/circle/diamond/triangle/line/star) shows the fill picker', () => {
    for (const tool of ['rect', 'circle', 'diamond', 'triangle', 'line', 'star']) {
      fixture.componentRef.setInput('tool', tool);
      fixture.detectChanges();
      expect(fillGroups().length).toBe(2);
    }
  });

  it('emits fillColorChange with a palette colour when a fill swatch is clicked', () => {
    fixture.componentRef.setInput('tool', 'rect');
    fixture.detectChanges();
    let emitted: string | null | undefined;
    component.fillColorChange.subscribe((c) => (emitted = c));

    const fillGroup = fillGroups()[1];
    const swatch = fillGroup.querySelector('.wb-toolbar__swatch:not(.wb-toolbar__swatch--none)') as HTMLButtonElement;
    swatch.click();

    expect(emitted).toBeTruthy();
    expect(emitted).not.toBeNull();
  });

  it('emits fillColorChange(null) — "no fill" — when the none swatch is clicked', () => {
    fixture.componentRef.setInput('tool', 'rect');
    fixture.detectChanges();
    let emitted: string | null | undefined = 'not-called';
    component.fillColorChange.subscribe((c) => (emitted = c));

    const fillGroup = fillGroups()[1];
    const noneSwatch = fillGroup.querySelector('.wb-toolbar__swatch--none') as HTMLButtonElement;
    noneSwatch.click();

    expect(emitted).toBeNull();
  });

  it('marks the "no fill" swatch active when fillColor is null (the SHAPE default)', () => {
    fixture.componentRef.setInput('tool', 'rect');
    fixture.componentRef.setInput('fillColor', null);
    fixture.detectChanges();
    const fillGroup = fillGroups()[1];
    const noneSwatch = fillGroup.querySelector('.wb-toolbar__swatch--none') as HTMLButtonElement;
    expect(noneSwatch.classList.contains('wb-toolbar__swatch--active')).toBe(true);
  });

  it('the stroke colour group is still present and functional when a SHAPE tool is active', () => {
    fixture.componentRef.setInput('tool', 'circle');
    fixture.detectChanges();
    let emitted: string | undefined;
    component.colorChange.subscribe((c) => (emitted = c));

    const strokeGroup = fillGroups()[0];
    const swatch = strokeGroup.querySelector('.wb-toolbar__swatch') as HTMLButtonElement;
    swatch.click();

    expect(emitted).toBeTruthy();
  });

  it('disables every fill swatch when the toolbar is disabled (read-only board)', () => {
    fixture.componentRef.setInput('tool', 'rect');
    fixture.componentRef.setInput('disabled', true);
    fixture.detectChanges();
    const fillGroup = fillGroups()[1];
    const swatches = fillGroup.querySelectorAll<HTMLButtonElement>('.wb-toolbar__swatch');
    swatches.forEach((s) => expect(s.disabled).toBe(true));
  });
});

const FR_TRANSLATIONS = {
  whiteboard: {
    toolbar: {
      label: "Barre d'outils",
      select: 'Sélection',
      pan: 'Déplacer la vue',
      sticky: 'Post-it',
      text: 'Texte',
      rect: 'Rectangle',
      circle: 'Cercle',
      diamond: 'Losange',
      triangle: 'Triangle',
      line: 'Ligne',
      star: 'Étoile',
      draw: 'Dessin libre',
      table: 'Tableau',
      link: 'Relier des cartes',
      colorGroup: 'Couleurs',
      pickColor: 'Couleur {{color}}',
    },
    card: {
      image: {
        insertButton: 'Insérer une image',
        uploadInput: 'Choisir un fichier image',
      },
    },
  },
};

/** US08.6.4 — the toolbar's "insert image" button + hidden accessible file input. */
describe('FloatingToolbarComponent — image insertion (US08.6.4)', () => {
  let fixture: ComponentFixture<FloatingToolbarComponent>;

  async function create(): Promise<void> {
    await TestBed.configureTestingModule({
      imports: [
        FloatingToolbarComponent,
        TranslocoTestingModule.forRoot({
          langs: { fr: FR_TRANSLATIONS },
          translocoConfig: { defaultLang: 'fr', availableLangs: ['fr'] },
          preloadLangs: true,
        }),
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(FloatingToolbarComponent);
    fixture.detectChanges();
  }

  it('renders a labelled "insert image" button and a labelled, hidden file input', async () => {
    await create();
    const btn = fixture.nativeElement.querySelector('[aria-label="Insérer une image"]') as HTMLButtonElement;
    const input = fixture.nativeElement.querySelector('input[type="file"]') as HTMLInputElement;
    expect(btn).toBeTruthy();
    expect(input).toBeTruthy();
    expect(input.getAttribute('aria-label')).toBe('Choisir un fichier image');
    expect(input.accept).toContain('image/png');
  });

  it('clicking the button opens the native file picker (delegates to the hidden input)', async () => {
    await create();
    const input = fixture.nativeElement.querySelector('input[type="file"]') as HTMLInputElement;
    const clickSpy = vi.spyOn(input, 'click');
    const btn = fixture.nativeElement.querySelector('[aria-label="Insérer une image"]') as HTMLButtonElement;

    btn.click();

    expect(clickSpy).toHaveBeenCalledTimes(1);
  });

  it('does not open the file picker while the toolbar is disabled', async () => {
    await create();
    fixture.componentRef.setInput('disabled', true);
    fixture.detectChanges();
    const input = fixture.nativeElement.querySelector('input[type="file"]') as HTMLInputElement;
    const clickSpy = vi.spyOn(input, 'click');
    const btn = fixture.nativeElement.querySelector('[aria-label="Insérer une image"]') as HTMLButtonElement;

    btn.click();

    expect(clickSpy).not.toHaveBeenCalled();
  });

  it('emits insertImage with the selected file and resets the input value', async () => {
    await create();
    const emitted: File[] = [];
    fixture.componentInstance.insertImage.subscribe((f: File) => emitted.push(f));
    const input = fixture.nativeElement.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['data'], 'photo.png', { type: 'image/png' });
    Object.defineProperty(input, 'files', { value: [file], configurable: true });

    input.dispatchEvent(new Event('change'));

    expect(emitted).toEqual([file]);
    expect(input.value).toBe('');
  });

  it('does not emit when the input change fires with no file selected', async () => {
    await create();
    const emitted: File[] = [];
    fixture.componentInstance.insertImage.subscribe((f: File) => emitted.push(f));
    const input = fixture.nativeElement.querySelector('input[type="file"]') as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: [], configurable: true });

    input.dispatchEvent(new Event('change'));

    expect(emitted).toEqual([]);
  });
});
