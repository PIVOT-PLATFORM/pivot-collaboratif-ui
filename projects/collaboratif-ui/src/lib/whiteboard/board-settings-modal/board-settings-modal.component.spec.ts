import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { TranslocoTestingModule } from '@jsverse/transloco';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { BoardSettingsModalComponent, DESCRIPTION_MAX_LENGTH } from './board-settings-modal.component';
import { ToastService } from '../../core/toast/toast.service';
import { Board } from '../../core/whiteboard/board.model';
import { COLLABORATIF_API_URL } from '../../core/whiteboard/config/tokens';

const TEST_API_URL = 'http://localhost:8083/api/collaboratif';
const BASE = `${TEST_API_URL}/whiteboard/boards`;

const FR_TRANSLATIONS = {
  whiteboard: {
    board: {
      reset: 'Réinitialiser le tableau',
      resetAria: 'Réinitialiser le tableau {{title}} — supprime tout le contenu du canvas',
      settings: {
        open: 'Paramètres du tableau',
        title: 'Paramètres de « {{title}} »',
        close: 'Fermer les paramètres',
        nameLabel: 'Nom du tableau',
        descriptionLabel: 'Description',
        descriptionHint: '500 caractères maximum',
        activitiesLabel: 'Activités disponibles',
        activitySoon: 'Bientôt disponible',
        save: 'Enregistrer',
        saveSuccess: 'Paramètres enregistrés',
        saveError: "Impossible d'enregistrer les paramètres",
        saveAsTemplate: 'Enregistrer comme template',
        saveAsTemplateNamePrompt: 'Nom du template',
        saveAsTemplateSuccess: 'Template enregistré',
        saveAsTemplateError: "Impossible d'enregistrer le template",
        resetConfirm: {
          title: 'Réinitialiser « {{title}} » ?',
          message: 'Tous les éléments du canvas seront supprimés.',
          confirm: 'Réinitialiser',
          cancel: 'Annuler',
        },
        resetSuccess: 'Tableau réinitialisé',
        resetError: 'Impossible de réinitialiser le tableau',
      },
      trash: {
        purgeConfirm: { cancel: 'Annuler' },
      },
    },
    activities: {
      items: {
        brainstorming: { name: 'Brainstorming' },
        poll: { name: 'Sondage' },
        dotvote: { name: 'Vote à points' },
        icebreaker: { name: 'Icebreaker' },
        quiz: { name: 'Quiz' },
        timer: { name: 'Minuteur' },
        retro: { name: 'Rétrospective' },
      },
    },
  },
};

function makeBoard(overrides: Partial<Board> = {}): Board {
  return {
    id: 'board-settings-1',
    title: 'Mon tableau',
    role: 'owner',
    createdAt: '',
    updatedAt: '',
    thumbnailUrl: null,
    activeParticipantCount: 0,
    favorite: false,
    description: null,
    coverImage: null,
    maxParticipants: null,
    enabledActivities: [],
    deletedAt: null,
    ...overrides,
  };
}

describe('BoardSettingsModalComponent', () => {
  let fixture: ComponentFixture<BoardSettingsModalComponent>;
  let httpMock: HttpTestingController;
  let toastService: ToastService;

  async function create(board = makeBoard(), triggerElement: HTMLElement | null = null): Promise<void> {
    await TestBed.configureTestingModule({
      imports: [
        BoardSettingsModalComponent,
        TranslocoTestingModule.forRoot({
          langs: { fr: FR_TRANSLATIONS },
          translocoConfig: { defaultLang: 'fr', availableLangs: ['fr'] },
          preloadLangs: true,
        }),
      ],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: COLLABORATIF_API_URL, useValue: TEST_API_URL },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(BoardSettingsModalComponent);
    fixture.componentRef.setInput('board', board);
    fixture.componentRef.setInput('triggerElement', triggerElement);
    httpMock = TestBed.inject(HttpTestingController);
    toastService = TestBed.inject(ToastService);
    fixture.detectChanges();
  }

  afterEach(() => {
    httpMock.verify();
    TestBed.resetTestingModule();
  });

  // ── AC08.2.4: modal opens with name/description/activities/actions ──
  it('ac08_2_4_16_renders dialog role with name, description and activity toggles', async () => {
    await create(makeBoard({ title: 'Sprint planning', description: 'Notes' }));
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('[role="dialog"]')).toBeTruthy();
    expect((el.querySelector('#settings-name-input') as HTMLInputElement).value).toBe('Sprint planning');
    expect((el.querySelector('#settings-description-input') as HTMLTextAreaElement).value).toBe('Notes');
    expect(el.querySelectorAll('[role="switch"]').length).toBe(7);
  });

  it('ac08_2_4_17_focuses the first field on open (A11y)', async () => {
    await create();
    await new Promise((r) => setTimeout(r, 0));
    const input = fixture.nativeElement.querySelector('#settings-name-input') as HTMLInputElement;
    expect(document.activeElement).toBe(input);
  });

  it('ac08_2_4_18_restores focus to the trigger element on destroy (A11y)', async () => {
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);
    await create(makeBoard(), trigger);
    fixture.destroy();
    expect(document.activeElement).toBe(trigger);
    trigger.remove();
  });

  // ── AC08.2.4: activity toggles are disabled (none delivered yet) ──
  it('ac08_2_4_19_every activity toggle is disabled with a "coming soon" hint', async () => {
    await create();
    const toggles = Array.from(fixture.nativeElement.querySelectorAll('[role="switch"]')) as HTMLButtonElement[];
    expect(toggles.length).toBeGreaterThan(0);
    toggles.forEach((t) => {
      expect(t.disabled).toBe(true);
      expect(t.getAttribute('aria-checked')).toBe('false');
    });
  });

  // ── AC08.2.4: PATCH name/description ──
  it('ac08_2_4_20_save sends PATCH with title and description', async () => {
    await create(makeBoard({ id: 'b1', title: 'Old' }));
    const nameInput = fixture.nativeElement.querySelector('#settings-name-input') as HTMLInputElement;
    nameInput.value = 'New name';
    nameInput.dispatchEvent(new Event('input'));
    const descInput = fixture.nativeElement.querySelector('#settings-description-input') as HTMLTextAreaElement;
    descInput.value = 'New desc';
    descInput.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    (fixture.nativeElement.querySelector('.wb-settings__footer .wb-settings__btn--primary') as HTMLButtonElement).click();
    fixture.detectChanges();

    const req = httpMock.expectOne(r => r.url === `${BASE}/b1` && r.method === 'PATCH');
    expect(req.request.body).toEqual({ title: 'New name', description: 'New desc' });
    req.flush(makeBoard({ id: 'b1', title: 'New name', description: 'New desc' }));
  });

  it('ac08_2_4_21_save error shows a toast and keeps the modal open', async () => {
    await create(makeBoard({ id: 'b2' }));
    const toastSpy = vi.spyOn(toastService, 'show');
    (fixture.nativeElement.querySelector('.wb-settings__footer .wb-settings__btn--primary') as HTMLButtonElement).click();
    httpMock.expectOne(r => r.url === `${BASE}/b2` && r.method === 'PATCH')
      .flush('', { status: 403, statusText: 'Forbidden' });
    fixture.detectChanges();
    expect(toastSpy).toHaveBeenCalledWith('whiteboard.board.settings.saveError', 'error');
    expect(fixture.nativeElement.querySelector('[role="dialog"]')).toBeTruthy();
  });

  it('ac08_2_4_22_description is capped at 500 characters client-side', async () => {
    await create();
    const descInput = fixture.nativeElement.querySelector('#settings-description-input') as HTMLTextAreaElement;
    descInput.value = 'x'.repeat(600);
    descInput.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(descInput.value.length).toBe(DESCRIPTION_MAX_LENGTH);
  });

  // ── AC08.2.4: save as template ──
  it('ac08_2_4_23_save-as-template sends POST with the prompted name', async () => {
    await create(makeBoard({ id: 'b3', title: 'Rétro Sprint 5' }));
    (fixture.nativeElement.querySelector('.wb-settings__btn--secondary') as HTMLButtonElement).click();
    fixture.detectChanges();

    const promptInput = fixture.nativeElement.querySelector('.wb-settings__overlay .wb-settings__input') as HTMLInputElement;
    expect(promptInput.value).toBe('Rétro Sprint 5');
    promptInput.value = 'Mon modèle perso';
    promptInput.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    const confirmBtn = Array.from(
      fixture.nativeElement.querySelectorAll('.wb-settings__overlay .wb-settings__btn--primary'),
    )[0] as HTMLButtonElement;
    confirmBtn.click();
    fixture.detectChanges();

    const req = httpMock.expectOne(`${BASE}/b3/save-as-template`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ name: 'Mon modèle perso' });
    req.flush({ id: 'tpl-1', name: 'Mon modèle perso', description: null });
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.wb-settings__overlay')).toBeNull();
  });

  it('ac08_2_4_24_save-as-template error shows a toast and keeps the prompt open', async () => {
    await create(makeBoard({ id: 'b4' }));
    const toastSpy = vi.spyOn(toastService, 'show');
    (fixture.nativeElement.querySelector('.wb-settings__btn--secondary') as HTMLButtonElement).click();
    fixture.detectChanges();
    const confirmBtn = Array.from(
      fixture.nativeElement.querySelectorAll('.wb-settings__overlay .wb-settings__btn--primary'),
    )[0] as HTMLButtonElement;
    confirmBtn.click();
    httpMock.expectOne(`${BASE}/b4/save-as-template`).flush('', { status: 403, statusText: 'Forbidden' });
    fixture.detectChanges();
    expect(toastSpy).toHaveBeenCalledWith('whiteboard.board.settings.saveAsTemplateError', 'error');
  });

  // ── AC08.2.4: reset requires explicit confirmation dialog ──
  it('ac08_2_4_25_reset button opens a dedicated confirm dialog distinct from delete', async () => {
    await create(makeBoard({ title: 'Le tableau' }));
    (fixture.nativeElement.querySelector('.wb-settings__btn--danger') as HTMLButtonElement).click();
    fixture.detectChanges();
    const dialog = fixture.nativeElement.querySelector('[role="alertdialog"]') as HTMLElement;
    expect(dialog).toBeTruthy();
    expect(dialog.textContent).toContain('Le tableau');
    httpMock.expectNone(r => r.url.includes('/reset'));
  });

  it('ac08_2_4_26_confirming reset calls POST /reset and emits resetDone', async () => {
    await create(makeBoard({ id: 'b5' }));
    let resetDone = false;
    fixture.componentInstance.resetDone.subscribe(() => { resetDone = true; });

    (fixture.nativeElement.querySelector('.wb-settings__btn--danger') as HTMLButtonElement).click();
    fixture.detectChanges();
    const confirmBtn = fixture.nativeElement.querySelector('[role="alertdialog"] .wb-settings__btn--danger') as HTMLButtonElement;
    confirmBtn.click();
    fixture.detectChanges();

    const req = httpMock.expectOne(`${BASE}/b5/reset`);
    expect(req.request.method).toBe('POST');
    req.flush(null);
    fixture.detectChanges();

    expect(resetDone).toBe(true);
    expect(fixture.nativeElement.querySelector('[role="alertdialog"]')).toBeNull();
  });

  it('ac08_2_4_27_reset error shows a toast and does not emit resetDone', async () => {
    await create(makeBoard({ id: 'b6' }));
    const toastSpy = vi.spyOn(toastService, 'show');
    let resetDone = false;
    fixture.componentInstance.resetDone.subscribe(() => { resetDone = true; });

    (fixture.nativeElement.querySelector('.wb-settings__btn--danger') as HTMLButtonElement).click();
    fixture.detectChanges();
    (fixture.nativeElement.querySelector('[role="alertdialog"] .wb-settings__btn--danger') as HTMLButtonElement).click();
    httpMock.expectOne(`${BASE}/b6/reset`).flush('', { status: 500, statusText: 'Error' });
    fixture.detectChanges();

    expect(toastSpy).toHaveBeenCalledWith('whiteboard.board.settings.resetError', 'error');
    expect(resetDone).toBe(false);
  });

  it('ac08_2_4_28_cancel reset dialog does not call the API', async () => {
    await create();
    (fixture.nativeElement.querySelector('.wb-settings__btn--danger') as HTMLButtonElement).click();
    fixture.detectChanges();
    (fixture.nativeElement.querySelector('[role="alertdialog"] .wb-settings__btn--secondary') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[role="alertdialog"]')).toBeNull();
    httpMock.expectNone(r => r.url.includes('/reset'));
  });

  // ── AC08.2.4: close + focus trap ──
  it('ac08_2_4_29_Escape key closes the modal', async () => {
    await create();
    let closed = false;
    fixture.componentInstance.closed.subscribe(() => { closed = true; });
    fixture.nativeElement.querySelector('.wb-settings').dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
    );
    expect(closed).toBe(true);
  });

  it('ac08_2_4_30_close button emits closed', async () => {
    await create();
    let closed = false;
    fixture.componentInstance.closed.subscribe(() => { closed = true; });
    (fixture.nativeElement.querySelector('.wb-settings__close-btn') as HTMLButtonElement).click();
    expect(closed).toBe(true);
  });

  it('ac08_2_4_31_save button is disabled when the name is blank', async () => {
    await create(makeBoard({ title: 'x' }));
    const nameInput = fixture.nativeElement.querySelector('#settings-name-input') as HTMLInputElement;
    nameInput.value = '   ';
    nameInput.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    const saveBtn = fixture.nativeElement.querySelector('.wb-settings__footer .wb-settings__btn--primary') as HTMLButtonElement;
    expect(saveBtn.disabled).toBe(true);
  });

  // ── AC08.2.4: focus trap wraps Tab/Shift+Tab within the dialog ──
  //
  // The component's own onKeydown() queries the SAME selector used here
  // ('button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [tabindex]...')
  // via `this.host.nativeElement` (the whole component host, i.e. .wb-settings + its overlay
  // siblings) -- so these tests query from the component's root, not just the `.wb-settings` node,
  // to observe exactly the same focusable-element list the handler computes.
  function queryFocusable(): HTMLElement[] {
    const root: HTMLElement = fixture.nativeElement;
    // Note: unlike the component's own onKeydown() (which also filters offsetParent !== null to
    // skip hidden elements in a real browser), this test helper skips that filter -- JSDOM never
    // computes layout, so offsetParent is always null here regardless of visibility.
    return Array.from(
      root.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    );
  }

  it('ac08_2_4_32_Tab on the last focusable element wraps to the first (focus trap)', async () => {
    await create();
    const dialog = fixture.nativeElement.querySelector('.wb-settings') as HTMLElement;
    const focusable = queryFocusable();
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    last.focus();
    expect(document.activeElement).toBe(last);

    dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(first);
  });

  it('ac08_2_4_33_Shift+Tab on the first focusable element wraps to the last (focus trap)', async () => {
    await create();
    const dialog = fixture.nativeElement.querySelector('.wb-settings') as HTMLElement;
    const focusable = queryFocusable();
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    first.focus();
    expect(document.activeElement).toBe(first);

    dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(last);
  });

  it('ac08_2_4_34_Tab in the middle of the dialog does not force any refocus', async () => {
    await create();
    const dialog = fixture.nativeElement.querySelector('.wb-settings') as HTMLElement;
    const focusable = queryFocusable();
    expect(focusable.length).toBeGreaterThan(2);
    focusable[1].focus();
    dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
    // Native Tab order is left to the browser here — the handler simply does not intervene.
    expect(document.activeElement).toBe(focusable[1]);
  });
});
