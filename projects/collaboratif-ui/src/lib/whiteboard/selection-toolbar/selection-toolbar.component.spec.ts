import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslocoTestingModule } from '@jsverse/transloco';
import { SelectionToolbarComponent } from './selection-toolbar.component';

const FR = {
  whiteboard: {
    selection: {
      actions: 'Actions de sélection',
      count: '{{count}} sélectionné',
      countPlural: '{{count}} sélectionnés',
      color: 'Couleur',
      duplicate: 'Dupliquer (Ctrl+D)',
      lock: 'Verrouiller',
      unlock: 'Déverrouiller',
      delete: 'Supprimer (Suppr)',
    },
    layer: {
      bringToFront: 'Passer au premier plan',
      sendToBack: "Envoyer à l'arrière-plan",
    },
  },
};

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
