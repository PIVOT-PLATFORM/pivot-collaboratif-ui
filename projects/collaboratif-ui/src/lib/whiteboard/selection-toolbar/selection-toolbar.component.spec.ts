import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslocoTestingModule } from '@jsverse/transloco';
import { SelectionToolbarComponent } from './selection-toolbar.component';
import type { Connection } from '../model/board.types';

const FR = {
  whiteboard: {
    selection: {
      actions: 'Actions de sélection',
      count: '{{count}} sélectionné',
      countPlural: '{{count}} sélectionnés',
      color: 'Couleur',
      fill: 'Couleur de remplissage',
      duplicate: 'Dupliquer (Ctrl+D)',
      lock: 'Verrouiller',
      unlock: 'Déverrouiller',
      delete: 'Supprimer (Suppr)',
    },
    layer: {
      bringToFront: 'Passer au premier plan',
      sendToBack: "Envoyer à l'arrière-plan",
    },
    toolbar: {
      noFill: 'Aucun remplissage',
      connectorStyle: 'Style du lien',
      lineGroup: 'Trait',
      arrowGroup: 'Flèche',
      lineStyle: { solid: 'Trait plein', dashed: 'Tirets', dotted: 'Pointillés' },
      arrow: { none: 'Aucune flèche', end: "Flèche à l'arrivée", both: 'Flèche aux deux bouts' },
    },
  },
};

/** A connector with the extended style model (US08.7.2). */
function makeConnection(over: Partial<Connection> = {}): Connection {
  return {
    id: 'conn-1', boardId: 'b1', fromId: 'a', toId: 'b', label: null, color: null,
    shape: 'curved', arrow: 'none', dashed: false, width: 2,
    lineStyle: 'solid', startCap: 'none', endCap: 'none', ...over,
  } as Connection;
}

function btn(fixture: ComponentFixture<SelectionToolbarComponent>, label: string): HTMLButtonElement | undefined {
  return Array.from(fixture.nativeElement.querySelectorAll('button')).find(
    (b) => (b as HTMLButtonElement).getAttribute('aria-label') === label,
  ) as HTMLButtonElement | undefined;
}

describe('SelectionToolbarComponent', () => {
  let fixture: ComponentFixture<SelectionToolbarComponent>;
  let component: SelectionToolbarComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [
        SelectionToolbarComponent,
        TranslocoTestingModule.forRoot({
          langs: { fr: FR },
          translocoConfig: { defaultLang: 'fr', availableLangs: ['fr'] },
          preloadLangs: true,
        }),
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(SelectionToolbarComponent);
    component = fixture.componentInstance;
  });

  it('renders the singular count label for a single selection', () => {
    fixture.componentRef.setInput('count', 1);
    fixture.detectChanges();
    expect((fixture.nativeElement.querySelector('.wb-selbar__count') as HTMLElement).textContent?.trim()).toBe(
      '1 sélectionné',
    );
  });

  it('renders the plural count label beyond one', () => {
    fixture.componentRef.setInput('count', 3);
    fixture.detectChanges();
    expect((fixture.nativeElement.querySelector('.wb-selbar__count') as HTMLElement).textContent?.trim()).toBe(
      '3 sélectionnés',
    );
  });

  it('emits duplicate and remove on the matching buttons', () => {
    fixture.componentRef.setInput('count', 1);
    fixture.detectChanges();

    const duplicate = vi.fn();
    const remove = vi.fn();
    component.duplicate.subscribe(duplicate);
    component.remove.subscribe(remove);

    btn(fixture, 'Dupliquer (Ctrl+D)')!.click();
    btn(fixture, 'Supprimer (Suppr)')!.click();

    expect(duplicate).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it('opens the palette and emits recolor with the picked colour, then closes it', () => {
    fixture.componentRef.setInput('count', 1);
    fixture.componentRef.setInput('color', '#A5B4FC');
    fixture.detectChanges();

    const recolor = vi.fn();
    component.recolor.subscribe(recolor);

    expect(fixture.nativeElement.querySelector('.wb-selbar__palette')).toBeNull();
    btn(fixture, 'Couleur')!.click();
    fixture.detectChanges();

    const swatches = fixture.nativeElement.querySelectorAll('.wb-selbar__palette-swatch') as NodeListOf<HTMLButtonElement>;
    expect(swatches.length).toBeGreaterThan(0);
    swatches[0].click();
    fixture.detectChanges();

    expect(recolor).toHaveBeenCalledTimes(1);
    expect(recolor.mock.calls[0][0]).toMatch(/^#[0-9A-Fa-f]{6}$/);
    // Picking a colour closes the palette.
    expect(fixture.nativeElement.querySelector('.wb-selbar__palette')).toBeNull();
  });

  it('toggleLock emits the desired state and shows "unlock" when all locked', () => {
    fixture.componentRef.setInput('count', 2);
    fixture.componentRef.setInput('allLocked', true);
    fixture.detectChanges();

    const toggle = vi.fn();
    component.toggleLock.subscribe(toggle);
    btn(fixture, 'Déverrouiller')!.click();
    expect(toggle).toHaveBeenCalledWith(false);
  });

  it('emits bringToFront and sendToBack on the matching z-order buttons (US08.9.3)', () => {
    fixture.componentRef.setInput('count', 2);
    fixture.detectChanges();

    const front = vi.fn();
    const back = vi.fn();
    component.bringToFront.subscribe(front);
    component.sendToBack.subscribe(back);

    btn(fixture, 'Passer au premier plan')!.click();
    btn(fixture, "Envoyer à l'arrière-plan")!.click();

    expect(front).toHaveBeenCalledTimes(1);
    expect(back).toHaveBeenCalledTimes(1);
  });

  it('hides recolour / duplicate / lock / z-order on a read-only board but keeps delete', () => {
    fixture.componentRef.setInput('count', 1);
    fixture.componentRef.setInput('readOnly', true);
    fixture.detectChanges();

    expect(btn(fixture, 'Couleur')).toBeUndefined();
    expect(btn(fixture, 'Dupliquer (Ctrl+D)')).toBeUndefined();
    expect(btn(fixture, 'Verrouiller')).toBeUndefined();
    expect(btn(fixture, 'Passer au premier plan')).toBeUndefined();
    expect(btn(fixture, "Envoyer à l'arrière-plan")).toBeUndefined();
    expect(btn(fixture, 'Supprimer (Suppr)')).toBeDefined();
  });
});

/**
 * Fill + link style in the bottom bar (recette 2026-07-17).
 *
 * « il n'est pas possible de changer la couleur de remplissage d'une forme déjà posé » — a shape's
 * fill lives in its encoded `content`, not in `card.color`, so the existing swatch could not reach
 * it. « pour les lien (…) j'aimerai pouvoir changer ceux déjà relié avec la tool box horizontal en
 * bas » — restyling a drawn link lived in a panel in the far corner.
 */
describe('SelectionToolbarComponent — fill and link style', () => {
  let fixture: ComponentFixture<SelectionToolbarComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [
        SelectionToolbarComponent,
        TranslocoTestingModule.forRoot({
          langs: { fr: FR },
          translocoConfig: { defaultLang: 'fr', availableLangs: ['fr'] },
          preloadLangs: true,
        }),
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(SelectionToolbarComponent);
    fixture.componentRef.setInput('count', 1);
  });

  /** `undefined` means "no shape in the selection" — distinct from `null`, which means "no fill". */
  it('hides the fill swatch when the selection holds no shape', () => {
    fixture.detectChanges();

    expect(btn(fixture, 'Couleur de remplissage')).toBeUndefined();
  });

  it('shows the fill swatch as soon as a shape is selected, including with no fill', () => {
    fixture.componentRef.setInput('fillColor', null);
    fixture.detectChanges();

    expect(btn(fixture, 'Couleur de remplissage')).toBeTruthy();
  });

  it('emits the picked fill colour', () => {
    const emitted: (string | null)[] = [];
    fixture.componentInstance.refill.subscribe((f) => emitted.push(f));
    fixture.componentRef.setInput('fillColor', null);
    fixture.detectChanges();
    btn(fixture, 'Couleur de remplissage')!.click();
    fixture.detectChanges();

    (fixture.nativeElement.querySelectorAll('.wb-selbar__palette-swatch:not(.wb-selbar__palette-swatch--none)')[0] as HTMLButtonElement).click();

    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toMatch(/^#/);
  });

  /** "No fill" is a real choice, not the absence of one — it must be emittable. */
  it('emits null for "no fill"', () => {
    const emitted: (string | null)[] = [];
    fixture.componentInstance.refill.subscribe((f) => emitted.push(f));
    fixture.componentRef.setInput('fillColor', '#FF0000');
    fixture.detectChanges();
    btn(fixture, 'Couleur de remplissage')!.click();
    fixture.detectChanges();

    btn(fixture, 'Aucun remplissage')!.click();

    expect(emitted).toEqual([null]);
  });

  it('hides the link style button when no connector is selected', () => {
    fixture.detectChanges();

    expect(btn(fixture, 'Style du lien')).toBeUndefined();
  });

  it('emits a line style patch for the selected connector', () => {
    const emitted: unknown[] = [];
    fixture.componentInstance.connectionStyleChange.subscribe((p) => emitted.push(p));
    fixture.componentRef.setInput('connection', makeConnection());
    fixture.detectChanges();
    btn(fixture, 'Style du lien')!.click();
    fixture.detectChanges();

    btn(fixture, 'Pointillés')!.click();

    expect(emitted).toEqual([{ lineStyle: 'dotted' }]);
  });

  /** Both ends at once — the patch carries the pair, as the model makes them independent. */
  it('emits both caps for an arrow preset', () => {
    const emitted: unknown[] = [];
    fixture.componentInstance.connectionStyleChange.subscribe((p) => emitted.push(p));
    fixture.componentRef.setInput('connection', makeConnection());
    fixture.detectChanges();
    btn(fixture, 'Style du lien')!.click();
    fixture.detectChanges();

    btn(fixture, 'Flèche aux deux bouts')!.click();

    expect(emitted).toEqual([{ startCap: 'arrow', endCap: 'arrow' }]);
  });

  it('reflects the connector current style as pressed', () => {
    fixture.componentRef.setInput('connection', makeConnection({ lineStyle: 'dashed', startCap: 'none', endCap: 'arrow' }));
    fixture.detectChanges();
    btn(fixture, 'Style du lien')!.click();
    fixture.detectChanges();

    expect(btn(fixture, 'Tirets')!.getAttribute('aria-pressed')).toBe('true');
    expect(btn(fixture, "Flèche à l'arrivée")!.getAttribute('aria-pressed')).toBe('true');
    expect(btn(fixture, 'Aucune flèche')!.getAttribute('aria-pressed')).toBe('false');
  });

  it('offers nothing on a read-only board', () => {
    fixture.componentRef.setInput('fillColor', null);
    fixture.componentRef.setInput('connection', makeConnection());
    fixture.componentRef.setInput('readOnly', true);
    fixture.detectChanges();

    expect(btn(fixture, 'Couleur de remplissage')).toBeUndefined();
    expect(btn(fixture, 'Style du lien')).toBeUndefined();
  });
});
