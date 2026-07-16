import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslocoTestingModule } from '@jsverse/transloco';
import { SelectionToolbarComponent } from './selection-toolbar.component';

const FR = {
  whiteboard: {
    selection: {
      actions: 'Actions de sélection',
      count: '{{count}} sélectionné',
      countPlural: '{{count}} sélectionnés',
      copy: 'Copier (Ctrl+C)',
      paste: 'Coller (Ctrl+V)',
      duplicate: 'Dupliquer (Ctrl+D)',
      lock: 'Verrouiller',
      unlock: 'Déverrouiller',
      delete: 'Supprimer (Suppr)',
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

  it('emits copy / paste / duplicate / remove on the matching buttons', () => {
    fixture.componentRef.setInput('count', 1);
    fixture.componentRef.setInput('canPaste', true);
    fixture.detectChanges();

    const copy = vi.fn();
    const paste = vi.fn();
    const duplicate = vi.fn();
    const remove = vi.fn();
    component.copy.subscribe(copy);
    component.paste.subscribe(paste);
    component.duplicate.subscribe(duplicate);
    component.remove.subscribe(remove);

    btn(fixture, 'Copier (Ctrl+C)')!.click();
    btn(fixture, 'Coller (Ctrl+V)')!.click();
    btn(fixture, 'Dupliquer (Ctrl+D)')!.click();
    btn(fixture, 'Supprimer (Suppr)')!.click();

    expect(copy).toHaveBeenCalledTimes(1);
    expect(paste).toHaveBeenCalledTimes(1);
    expect(duplicate).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it('disables paste when the clipboard is empty', () => {
    fixture.componentRef.setInput('count', 1);
    fixture.componentRef.setInput('canPaste', false);
    fixture.detectChanges();
    expect(btn(fixture, 'Coller (Ctrl+V)')!.disabled).toBe(true);
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

  it('hides copy / duplicate / lock on a read-only board but keeps delete', () => {
    fixture.componentRef.setInput('count', 1);
    fixture.componentRef.setInput('readOnly', true);
    fixture.detectChanges();

    expect(btn(fixture, 'Copier (Ctrl+C)')).toBeUndefined();
    expect(btn(fixture, 'Dupliquer (Ctrl+D)')).toBeUndefined();
    expect(btn(fixture, 'Verrouiller')).toBeUndefined();
    expect(btn(fixture, 'Supprimer (Suppr)')).toBeDefined();
  });
});
