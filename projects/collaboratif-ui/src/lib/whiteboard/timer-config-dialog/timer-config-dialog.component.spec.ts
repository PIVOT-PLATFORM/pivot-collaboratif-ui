import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslocoTestingModule } from '@jsverse/transloco';
import { TimerConfigDialogComponent } from './timer-config-dialog.component';

const FR = {
  whiteboard: {
    timer: {
      config: {
        title: 'Démarrer un minuteur',
        hint: 'Cadrez votre atelier',
        presetsLabel: 'Durées prédéfinies',
        minutes: '{{count}} min',
        custom: 'Durée personnalisée',
        minutesLabel: 'Minutes',
        secondsLabel: 'Secondes',
        minUnit: 'min',
        secUnit: 's',
        start: 'Démarrer',
        cancel: 'Annuler',
      },
    },
  },
};

describe('TimerConfigDialogComponent', () => {
  let fixture: ComponentFixture<TimerConfigDialogComponent>;
  let component: TimerConfigDialogComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [
        TimerConfigDialogComponent,
        TranslocoTestingModule.forRoot({
          langs: { fr: FR },
          translocoConfig: { defaultLang: 'fr', availableLangs: ['fr'] },
          preloadLangs: true,
        }),
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(TimerConfigDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('renders one chip per preset duration', () => {
    const presets = fixture.nativeElement.querySelectorAll('.wb-timercfg__preset');
    expect(presets.length).toBe(5);
    expect((presets[0] as HTMLElement).textContent?.trim()).toBe('1 min');
  });

  it('emits start with the preset duration in seconds', () => {
    const seconds: number[] = [];
    component.start.subscribe((s: number) => seconds.push(s));
    (fixture.nativeElement.querySelectorAll('.wb-timercfg__preset')[2] as HTMLButtonElement).click();
    expect(seconds).toEqual([5 * 60]);
  });

  it('emits start with the custom minutes/seconds total', () => {
    const [minInput, secInput] = fixture.nativeElement.querySelectorAll('.wb-timercfg__input') as NodeListOf<HTMLInputElement>;
    minInput.value = '2';
    minInput.dispatchEvent(new Event('input'));
    secInput.value = '30';
    secInput.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    const seconds: number[] = [];
    component.start.subscribe((s: number) => seconds.push(s));
    (fixture.nativeElement.querySelector('.wb-timercfg__btn--primary') as HTMLButtonElement).click();
    expect(seconds).toEqual([150]);
  });

  it('clamps an out-of-range custom duration to the minimum', () => {
    const [minInput, secInput] = fixture.nativeElement.querySelectorAll('.wb-timercfg__input') as NodeListOf<HTMLInputElement>;
    minInput.value = '0';
    minInput.dispatchEvent(new Event('input'));
    secInput.value = '0';
    secInput.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    const seconds: number[] = [];
    component.start.subscribe((s: number) => seconds.push(s));
    (fixture.nativeElement.querySelector('.wb-timercfg__btn--primary') as HTMLButtonElement).click();
    expect(seconds).toEqual([5]); // MIN_SECONDS floor
  });

  it('emits close from the cancel button', () => {
    const closed: boolean[] = [];
    component.close.subscribe(() => closed.push(true));
    (fixture.nativeElement.querySelector('.wb-timercfg__btn--ghost') as HTMLButtonElement).click();
    expect(closed).toEqual([true]);
  });

  it('emits close on Escape', () => {
    const closed: boolean[] = [];
    component.close.subscribe(() => closed.push(true));
    fixture.nativeElement.querySelector('.wb-timercfg').dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    );
    expect(closed).toEqual([true]);
  });
});
