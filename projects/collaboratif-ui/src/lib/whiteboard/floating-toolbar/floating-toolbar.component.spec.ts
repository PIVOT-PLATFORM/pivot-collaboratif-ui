import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslocoTestingModule } from '@jsverse/transloco';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { FloatingToolbarComponent } from './floating-toolbar.component';

/**
 * Tests for the retractable floating toolbar (PouetPouet port): the output contract
 * (toolChange / colorChange / fillColorChange / insertImage) is unchanged from the flat
 * version — only the UI is reorganised into a collapse handle, a grouped SHAPE submenu and a
 * colour popover. With empty translations, the Transloco pipe echoes the key, so buttons are
 * located by their `aria-label` key.
 */
function configure(): Promise<void> {
  return TestBed.configureTestingModule({
    imports: [
      FloatingToolbarComponent,
      TranslocoTestingModule.forRoot({
        langs: { fr: {}, en: {} },
        translocoConfig: { defaultLang: 'fr', availableLangs: ['fr', 'en'] },
        preloadLangs: true,
      }),
    ],
  }).compileComponents();
}

function byLabel(fixture: ComponentFixture<FloatingToolbarComponent>, key: string): HTMLButtonElement {
  return fixture.nativeElement.querySelector(`[aria-label="${key}"]`) as HTMLButtonElement;
}

describe('FloatingToolbarComponent — tool selection contract', () => {
  let fixture: ComponentFixture<FloatingToolbarComponent>;
  let component: FloatingToolbarComponent;

  const TOOL_KEYS: { key: string; mode: string }[] = [
    { key: 'whiteboard.toolbar.select', mode: 'select' },
    { key: 'whiteboard.toolbar.pan', mode: 'pan' },
    { key: 'whiteboard.toolbar.sticky', mode: 'sticky' },
    { key: 'whiteboard.toolbar.text', mode: 'text' },
    { key: 'whiteboard.toolbar.table', mode: 'table' },
    { key: 'whiteboard.toolbar.frame', mode: 'frame' },
    { key: 'whiteboard.toolbar.draw', mode: 'draw' },
    { key: 'whiteboard.toolbar.link', mode: 'link-cards' },
  ];

  beforeEach(async () => {
    sessionStorage.clear();
    await configure();
    fixture = TestBed.createComponent(FloatingToolbarComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('emits toolChange with the matching ToolMode for every direct tool button', () => {
    for (const { key, mode } of TOOL_KEYS) {
      let emitted: string | undefined;
      const sub = component.toolChange.subscribe((m) => (emitted = m));
      byLabel(fixture, key).click();
      expect(emitted).toBe(mode);
      sub.unsubscribe();
    }
  });

  it('marks the active tool with wb-toolbar__btn--active and aria-pressed', () => {
    fixture.componentRef.setInput('tool', 'sticky');
    fixture.detectChanges();
    const btn = byLabel(fixture, 'whiteboard.toolbar.sticky');
    expect(btn.classList.contains('wb-toolbar__btn--active')).toBe(true);
    expect(btn.getAttribute('aria-pressed')).toBe('true');
  });

  it('does not emit toolChange when disabled (read-only board)', () => {
    fixture.componentRef.setInput('disabled', true);
    fixture.detectChanges();
    let emitted: string | undefined;
    component.toolChange.subscribe((m) => (emitted = m));
    byLabel(fixture, 'whiteboard.toolbar.text').click();
    expect(emitted).toBeUndefined();
  });
});

describe('FloatingToolbarComponent — SHAPE submenu (grouped "Formes")', () => {
  let fixture: ComponentFixture<FloatingToolbarComponent>;
  let component: FloatingToolbarComponent;

  function shapesFlyout(): Element | null {
    return fixture.nativeElement.querySelector('.wb-toolbar__flyout--shapes');
  }
  function shapesButton(): HTMLButtonElement {
    return byLabel(fixture, 'whiteboard.toolbar.shapes');
  }

  beforeEach(async () => {
    sessionStorage.clear();
    await configure();
    fixture = TestBed.createComponent(FloatingToolbarComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('hides the shape submenu until the grouped button is opened', () => {
    expect(shapesFlyout()).toBeNull();
  });

  it('opens the submenu and activates the last-used shape (default rect) on first open', () => {
    let emitted: string | undefined;
    component.toolChange.subscribe((m) => (emitted = m));
    shapesButton().click();
    fixture.detectChanges();
    expect(shapesFlyout()).not.toBeNull();
    expect(shapesFlyout()!.querySelectorAll('.wb-toolbar__shape').length).toBe(6);
    expect(emitted).toBe('rect');
  });

  it('emits toolChange for the picked shape from the submenu', () => {
    shapesButton().click();
    fixture.detectChanges();
    let emitted: string | undefined;
    component.toolChange.subscribe((m) => (emitted = m));
    const star = byLabel(fixture, 'whiteboard.toolbar.star');
    star.click();
    expect(emitted).toBe('star');
  });

  it('marks the grouped button active when a SHAPE tool is the active tool', () => {
    fixture.componentRef.setInput('tool', 'diamond');
    fixture.detectChanges();
    expect(shapesButton().classList.contains('wb-toolbar__btn--active')).toBe(true);
  });

  it('does not open the submenu nor emit when disabled', () => {
    fixture.componentRef.setInput('disabled', true);
    fixture.detectChanges();
    let emitted: string | undefined;
    component.toolChange.subscribe((m) => (emitted = m));
    shapesButton().click();
    fixture.detectChanges();
    expect(shapesFlyout()).toBeNull();
    expect(emitted).toBeUndefined();
  });
});

describe('FloatingToolbarComponent — colour popover + SHAPE fill picker (US08.6.3)', () => {
  let fixture: ComponentFixture<FloatingToolbarComponent>;
  let component: FloatingToolbarComponent;

  function openColors(): void {
    // Idempotent: the trigger toggles, so only click when the popover is not already open.
    if (!fixture.nativeElement.querySelector('.wb-toolbar__flyout--colors')) {
      (fixture.nativeElement.querySelector('.wb-toolbar__color-btn') as HTMLButtonElement).click();
      fixture.detectChanges();
    }
  }
  function swatchGroups(): NodeListOf<Element> {
    return fixture.nativeElement.querySelectorAll('.wb-toolbar__flyout--colors .wb-toolbar__swatch-group');
  }

  beforeEach(async () => {
    sessionStorage.clear();
    await configure();
    fixture = TestBed.createComponent(FloatingToolbarComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('shows only the stroke colour group when a non-SHAPE tool is active', () => {
    fixture.componentRef.setInput('tool', 'select');
    fixture.detectChanges();
    openColors();
    expect(swatchGroups().length).toBe(1);
  });

  it('shows a second (fill) colour group when a SHAPE tool is active', () => {
    fixture.componentRef.setInput('tool', 'rect');
    fixture.detectChanges();
    openColors();
    expect(swatchGroups().length).toBe(2);
  });

  it('every SHAPE tool (rect/circle/diamond/triangle/line/star) shows the fill picker', () => {
    for (const tool of ['rect', 'circle', 'diamond', 'triangle', 'line', 'star']) {
      fixture.componentRef.setInput('tool', tool);
      fixture.detectChanges();
      openColors();
      expect(swatchGroups().length).toBe(2);
    }
  });

  it('emits fillColorChange with a palette colour when a fill swatch is clicked', () => {
    fixture.componentRef.setInput('tool', 'rect');
    fixture.detectChanges();
    openColors();
    let emitted: string | null | undefined;
    component.fillColorChange.subscribe((c) => (emitted = c));

    const fillGroup = swatchGroups()[1];
    const swatch = fillGroup.querySelector('.wb-toolbar__swatch:not(.wb-toolbar__swatch--none)') as HTMLButtonElement;
    swatch.click();

    expect(emitted).toBeTruthy();
    expect(emitted).not.toBeNull();
  });

  it('emits fillColorChange(null) — "no fill" — when the none swatch is clicked', () => {
    fixture.componentRef.setInput('tool', 'rect');
    fixture.detectChanges();
    openColors();
    let emitted: string | null | undefined = 'not-called';
    component.fillColorChange.subscribe((c) => (emitted = c));

    const noneSwatch = swatchGroups()[1].querySelector('.wb-toolbar__swatch--none') as HTMLButtonElement;
    noneSwatch.click();

    expect(emitted).toBeNull();
  });

  it('marks the "no fill" swatch active when fillColor is null (the SHAPE default)', () => {
    fixture.componentRef.setInput('tool', 'rect');
    fixture.componentRef.setInput('fillColor', null);
    fixture.detectChanges();
    openColors();
    const noneSwatch = swatchGroups()[1].querySelector('.wb-toolbar__swatch--none') as HTMLButtonElement;
    expect(noneSwatch.classList.contains('wb-toolbar__swatch--active')).toBe(true);
  });

  it('the stroke colour group still emits colorChange when a SHAPE tool is active', () => {
    fixture.componentRef.setInput('tool', 'circle');
    fixture.detectChanges();
    openColors();
    let emitted: string | undefined;
    component.colorChange.subscribe((c) => (emitted = c));

    const swatch = swatchGroups()[0].querySelector('.wb-toolbar__swatch') as HTMLButtonElement;
    swatch.click();

    expect(emitted).toBeTruthy();
  });

  it('disables every fill swatch when the toolbar becomes disabled (read-only board)', () => {
    fixture.componentRef.setInput('tool', 'rect');
    fixture.detectChanges();
    openColors();
    fixture.componentRef.setInput('disabled', true);
    fixture.detectChanges();
    const swatches = swatchGroups()[1].querySelectorAll<HTMLButtonElement>('.wb-toolbar__swatch');
    swatches.forEach((s) => expect(s.disabled).toBe(true));
  });

  it('cannot open the colour popover when disabled', () => {
    fixture.componentRef.setInput('disabled', true);
    fixture.detectChanges();
    openColors();
    expect(fixture.nativeElement.querySelector('.wb-toolbar__flyout--colors')).toBeNull();
  });
});

describe('FloatingToolbarComponent — retractable bar', () => {
  let fixture: ComponentFixture<FloatingToolbarComponent>;

  function collapseBtn(): HTMLButtonElement {
    return fixture.nativeElement.querySelector('.wb-toolbar__collapse') as HTMLButtonElement;
  }

  beforeEach(async () => {
    sessionStorage.clear();
    await configure();
    fixture = TestBed.createComponent(FloatingToolbarComponent);
    fixture.detectChanges();
  });

  it('starts expanded with tool groups visible', () => {
    expect(fixture.nativeElement.querySelector('.wb-toolbar--collapsed')).toBeNull();
    expect(fixture.nativeElement.querySelectorAll('.wb-toolbar__group').length).toBeGreaterThan(0);
  });

  it('collapses and expands, hiding the tool groups while collapsed', () => {
    collapseBtn().click();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.wb-toolbar--collapsed')).not.toBeNull();
    expect(fixture.nativeElement.querySelectorAll('.wb-toolbar__group').length).toBe(0);
    expect(fixture.nativeElement.querySelector('.wb-toolbar__current')).not.toBeNull();

    collapseBtn().click();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.wb-toolbar--collapsed')).toBeNull();
    expect(fixture.nativeElement.querySelectorAll('.wb-toolbar__group').length).toBeGreaterThan(0);
  });

  it('reflects the collapsed state on aria-expanded', () => {
    expect(collapseBtn().getAttribute('aria-expanded')).toBe('true');
    collapseBtn().click();
    fixture.detectChanges();
    expect(collapseBtn().getAttribute('aria-expanded')).toBe('false');
  });

  it('persists the collapsed state to sessionStorage for the session', () => {
    collapseBtn().click();
    fixture.detectChanges();
    expect(sessionStorage.getItem('wb-toolbar-collapsed')).toBe('1');

    const next = TestBed.createComponent(FloatingToolbarComponent);
    next.detectChanges();
    expect(next.nativeElement.querySelector('.wb-toolbar--collapsed')).not.toBeNull();
  });
});

/** US08.6.4 — the toolbar's "insert image" button + hidden accessible file input. */
describe('FloatingToolbarComponent — image insertion (US08.6.4)', () => {
  let fixture: ComponentFixture<FloatingToolbarComponent>;

  function imageButton(): HTMLButtonElement {
    return byLabel(fixture, 'whiteboard.card.image.insertButton');
  }

  beforeEach(async () => {
    sessionStorage.clear();
    await configure();
    fixture = TestBed.createComponent(FloatingToolbarComponent);
    fixture.detectChanges();
  });

  it('renders a labelled "insert image" button and a labelled, hidden file input', () => {
    const btn = imageButton();
    const input = fixture.nativeElement.querySelector('input[type="file"]') as HTMLInputElement;
    expect(btn).toBeTruthy();
    expect(input).toBeTruthy();
    expect(input.getAttribute('aria-label')).toBe('whiteboard.card.image.uploadInput');
    expect(input.accept).toContain('image/png');
  });

  it('clicking the button opens the native file picker (delegates to the hidden input)', () => {
    const input = fixture.nativeElement.querySelector('input[type="file"]') as HTMLInputElement;
    const clickSpy = vi.spyOn(input, 'click');
    imageButton().click();
    expect(clickSpy).toHaveBeenCalledTimes(1);
  });

  it('does not open the file picker while the toolbar is disabled', () => {
    fixture.componentRef.setInput('disabled', true);
    fixture.detectChanges();
    const input = fixture.nativeElement.querySelector('input[type="file"]') as HTMLInputElement;
    const clickSpy = vi.spyOn(input, 'click');
    imageButton().click();
    expect(clickSpy).not.toHaveBeenCalled();
  });

  it('emits insertImage with the selected file and resets the input value', () => {
    const emitted: File[] = [];
    fixture.componentInstance.insertImage.subscribe((f: File) => emitted.push(f));
    const input = fixture.nativeElement.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['data'], 'photo.png', { type: 'image/png' });
    Object.defineProperty(input, 'files', { value: [file], configurable: true });

    input.dispatchEvent(new Event('change'));

    expect(emitted).toEqual([file]);
    expect(input.value).toBe('');
  });

  it('does not emit when the input change fires with no file selected', () => {
    const emitted: File[] = [];
    fixture.componentInstance.insertImage.subscribe((f: File) => emitted.push(f));
    const input = fixture.nativeElement.querySelector('input[type="file"]') as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: [], configurable: true });

    input.dispatchEvent(new Event('change'));

    expect(emitted).toEqual([]);
  });
});

/**
 * Tooltips + contextual hint (recette: "pourquoi le tool tip ne s'affiche pas ?").
 *
 * The native `title` is gone from every button: it duplicated the `aria-label` for screen-reader
 * users, and its delay and content were the browser's to decide. `wbTooltip` replaces it and can
 * carry the tool's shortcut.
 */
describe('FloatingToolbarComponent — tooltips and contextual hint', () => {
  let fixture: ComponentFixture<FloatingToolbarComponent>;

  beforeEach(async () => {
    await configure();
    fixture = TestBed.createComponent(FloatingToolbarComponent);
    fixture.detectChanges();
  });

  /** A leftover `title` would produce a second, native tooltip on top of the custom one. */
  it('leaves no native title on any button', () => {
    const titled = fixture.nativeElement.querySelectorAll('[title]');

    expect(titled).toHaveLength(0);
  });

  it('shows the shortcut in a tool tooltip after the delay', async () => {
    vi.useFakeTimers();
    try {
      byLabel(fixture, 'whiteboard.toolbar.sticky').dispatchEvent(new Event('pointerenter'));
      vi.advanceTimersByTime(400);

      const tip = document.querySelector('.wb-tooltip');
      expect(tip?.textContent).toContain('whiteboard.toolbar.sticky');
      expect(tip?.querySelector('.wb-tooltip__key')?.textContent).toBe('N');
    } finally {
      document.querySelectorAll('.wb-tooltip').forEach((el) => el.remove());
      vi.useRealTimers();
    }
  });

  /** Before this, the bar only ever said "Échap": it told the user how to leave a tool, never
   *  what the tool they had just picked would do. */
  it('describes the active tool, on top of the Échap reminder', () => {
    fixture.componentRef.setInput('tool', 'frame');
    fixture.detectChanges();

    const hint = fixture.nativeElement.querySelector('.wb-toolbar__hint');
    expect(hint.querySelector('.wb-toolbar__hint-text').textContent.trim()).toBe('whiteboard.toolbar.hint.frame');
    expect(hint.querySelector('.wb-toolbar__hint-esc').textContent.trim()).toBe('whiteboard.toolbar.escapeHint');
  });

  /** Every shape shares one hint — "drag to draw the shape" holds for all six. */
  it('uses the shared shape hint for any SHAPE tool', () => {
    fixture.componentRef.setInput('tool', 'triangle');
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.wb-toolbar__hint-text').textContent.trim()).toBe(
      'whiteboard.toolbar.hint.shape',
    );
  });

  it('shows no hint for the select tool, which needs no explanation', () => {
    fixture.componentRef.setInput('tool', 'select');
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.wb-toolbar__hint')).toBeNull();
  });
});

/**
 * Connector presets (recette: "les lien … possiblité d'ajouter une fleche aux bouts / pointillé").
 *
 * Styling a connector already existed (US08.7.2) but only *after* drawing one and selecting it —
 * so users never found it. These presets let the style be chosen before drawing, mirroring how the
 * SHAPE fill picker is gated on `isShapeTool()`. They speak the extended model (lineStyle + caps),
 * so the toolbar and the style panel cannot describe a connector differently.
 */
describe('FloatingToolbarComponent — connector presets', () => {
  let fixture: ComponentFixture<FloatingToolbarComponent>;

  beforeEach(async () => {
    await configure();
    fixture = TestBed.createComponent(FloatingToolbarComponent);
    fixture.componentRef.setInput('tool', 'link-cards');
    fixture.detectChanges();
  });

  function openPresets(): void {
    byLabel(fixture, 'whiteboard.toolbar.connectorStyle').click();
    fixture.detectChanges();
  }

  it('shows the connector presets button only while the connector tool is active', () => {
    expect(byLabel(fixture, 'whiteboard.toolbar.connectorStyle')).toBeTruthy();

    fixture.componentRef.setInput('tool', 'sticky');
    fixture.detectChanges();

    expect(byLabel(fixture, 'whiteboard.toolbar.connectorStyle')).toBeNull();
  });

  /** An arrow preset is a (startCap, endCap) pair — the two ends are independent in the model. */
  it('emits both caps for the "arrow at both ends" preset', () => {
    const emitted: { startCap: string; endCap: string }[] = [];
    fixture.componentInstance.connectorCapsChange.subscribe((c) => emitted.push(c));
    openPresets();

    byLabel(fixture, 'whiteboard.toolbar.arrow.both').click();

    expect(emitted).toEqual([{ startCap: 'arrow', endCap: 'arrow' }]);
  });

  it('emits an end-only arrow as a cap on the end alone', () => {
    const emitted: { startCap: string; endCap: string }[] = [];
    fixture.componentInstance.connectorCapsChange.subscribe((c) => emitted.push(c));
    openPresets();

    byLabel(fixture, 'whiteboard.toolbar.arrow.end').click();

    expect(emitted).toEqual([{ startCap: 'none', endCap: 'arrow' }]);
  });

  /** The active preset is the one whose *pair* matches — not a single enum value. */
  it('marks the arrow preset matching the current caps as pressed', () => {
    fixture.componentRef.setInput('connectorStartCap', 'none');
    fixture.componentRef.setInput('connectorEndCap', 'arrow');
    fixture.detectChanges();
    openPresets();

    expect(byLabel(fixture, 'whiteboard.toolbar.arrow.end').getAttribute('aria-pressed')).toBe('true');
    expect(byLabel(fixture, 'whiteboard.toolbar.arrow.both').getAttribute('aria-pressed')).toBe('false');
    expect(byLabel(fixture, 'whiteboard.toolbar.arrow.none').getAttribute('aria-pressed')).toBe('false');
  });

  /**
   * A cap shape the presets do not offer (triangle, circle, diamond — style panel only) must not
   * light up an unrelated preset: none of the three pairs matches.
   */
  it('marks no arrow preset as pressed when the caps come from the style panel', () => {
    fixture.componentRef.setInput('connectorStartCap', 'diamond');
    fixture.componentRef.setInput('connectorEndCap', 'circle');
    fixture.detectChanges();
    openPresets();

    for (const id of ['none', 'end', 'both']) {
      expect(byLabel(fixture, `whiteboard.toolbar.arrow.${id}`).getAttribute('aria-pressed')).toBe('false');
    }
  });

  it('offers the three line styles and emits the one picked', () => {
    const emitted: string[] = [];
    fixture.componentInstance.connectorLineStyleChange.subscribe((s) => emitted.push(s));
    openPresets();

    byLabel(fixture, 'whiteboard.toolbar.lineStyle.dotted').click();

    expect(emitted).toEqual(['dotted']);
  });

  /** `dotted` was unreachable before: the old boolean `dashed` had no room for a third style. */
  it('distinguishes dotted from dashed in the preview dash pattern', () => {
    openPresets();
    const dash = (id: string) =>
      byLabel(fixture, `whiteboard.toolbar.lineStyle.${id}`).querySelector('path')?.getAttribute('stroke-dasharray');

    expect(dash('solid')).toBeNull();
    expect(dash('dashed')).not.toBeNull();
    expect(dash('dotted')).not.toBe(dash('dashed'));
  });

  it('reflects the active line style with aria-pressed', () => {
    fixture.componentRef.setInput('connectorLineStyle', 'dashed');
    fixture.detectChanges();
    openPresets();

    expect(byLabel(fixture, 'whiteboard.toolbar.lineStyle.dashed').getAttribute('aria-pressed')).toBe('true');
    expect(byLabel(fixture, 'whiteboard.toolbar.lineStyle.solid').getAttribute('aria-pressed')).toBe('false');
  });

  it('emits nothing on a read-only board', () => {
    fixture.componentRef.setInput('disabled', true);
    fixture.detectChanges();
    const emitted: unknown[] = [];
    fixture.componentInstance.connectorCapsChange.subscribe((c) => emitted.push(c));

    byLabel(fixture, 'whiteboard.toolbar.connectorStyle').click();
    fixture.detectChanges();

    // The popover never opens, so no preset can be picked.
    expect(byLabel(fixture, 'whiteboard.toolbar.arrow.both')).toBeNull();
    expect(emitted).toEqual([]);
  });
});
