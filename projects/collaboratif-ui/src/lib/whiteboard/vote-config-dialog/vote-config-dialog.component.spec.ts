import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslocoTestingModule } from '@jsverse/transloco';
import { VoteConfigDialogComponent, type VoteConfig } from './vote-config-dialog.component';

const FR = {
  whiteboard: {
    vote: {
      config: {
        title: 'Lancer un vote',
        hint: 'Répartissez vos points',
        budget: 'Points par personne',
        decrease: 'Retirer un point',
        increase: 'Ajouter un point',
        withTimer: 'Limiter dans le temps',
        timerMinutesLabel: 'Durée en minutes',
        minUnit: 'min',
        start: 'Lancer le vote',
        cancel: 'Annuler',
      },
    },
  },
};

describe('VoteConfigDialogComponent', () => {
  let fixture: ComponentFixture<VoteConfigDialogComponent>;
  let component: VoteConfigDialogComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [
        VoteConfigDialogComponent,
        TranslocoTestingModule.forRoot({
          langs: { fr: FR },
          translocoConfig: { defaultLang: 'fr', availableLangs: ['fr'] },
          preloadLangs: true,
        }),
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(VoteConfigDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  function stepper(label: string): HTMLButtonElement {
    return Array.from(fixture.nativeElement.querySelectorAll('.wb-votecfg__step')).find(
      (b) => (b as HTMLButtonElement).getAttribute('aria-label') === label,
    ) as HTMLButtonElement;
  }

  it('starts with a default budget of 3 votes and no timer', () => {
    let cfg: VoteConfig | undefined;
    component.start.subscribe((c: VoteConfig) => (cfg = c));
    (fixture.nativeElement.querySelector('.wb-votecfg__btn--primary') as HTMLButtonElement).click();
    expect(cfg).toEqual({ votesPerPerson: 3, timerSeconds: null });
  });

  it('increments and clamps the vote budget with the stepper', () => {
    stepper('Ajouter un point').click();
    stepper('Ajouter un point').click();
    fixture.detectChanges();
    expect((fixture.nativeElement.querySelector('.wb-votecfg__count') as HTMLElement).textContent?.trim()).toBe('5');

    let cfg: VoteConfig | undefined;
    component.start.subscribe((c: VoteConfig) => (cfg = c));
    (fixture.nativeElement.querySelector('.wb-votecfg__btn--primary') as HTMLButtonElement).click();
    expect(cfg?.votesPerPerson).toBe(5);
  });

  it('emits a timerSeconds total when the timer toggle is enabled', () => {
    const toggle = fixture.nativeElement.querySelector('.wb-votecfg__toggle input') as HTMLInputElement;
    toggle.checked = true;
    toggle.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    const minutes = fixture.nativeElement.querySelector('.wb-votecfg__input') as HTMLInputElement;
    minutes.value = '3';
    minutes.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    let cfg: VoteConfig | undefined;
    component.start.subscribe((c: VoteConfig) => (cfg = c));
    (fixture.nativeElement.querySelector('.wb-votecfg__btn--primary') as HTMLButtonElement).click();
    expect(cfg?.timerSeconds).toBe(180);
  });

  it('emits close from the cancel button', () => {
    const closed: boolean[] = [];
    component.close.subscribe(() => closed.push(true));
    (fixture.nativeElement.querySelector('.wb-votecfg__btn--ghost') as HTMLButtonElement).click();
    expect(closed).toEqual([true]);
  });
});
