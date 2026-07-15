import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslocoTestingModule } from '@jsverse/transloco';
import { describe, it, expect, beforeEach } from 'vitest';
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
