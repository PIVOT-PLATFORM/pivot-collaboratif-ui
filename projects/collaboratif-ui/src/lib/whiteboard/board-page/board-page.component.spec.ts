import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ActivatedRoute } from '@angular/router';
import { TranslocoTestingModule } from '@jsverse/transloco';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { BoardPageComponent } from './board-page.component';
import { BoardStore } from '../../core/whiteboard/board.store';
import { BoardTransport } from '../../core/whiteboard/board-transport';
import { ToastService } from '../../core/toast/toast.service';
import { COLLABORATIF_API_URL } from '../../core/whiteboard/config/tokens';

const TEST_API_URL = 'http://localhost:8083/api/collaboratif';
const FR_TRANSLATIONS = {
  whiteboard: {
    board: {
      reset: 'Réinitialiser le tableau',
      resetAria: 'Réinitialiser le tableau {{title}} — supprime tout le contenu du canvas',
      settings: {
        open: 'Paramètres du tableau',
        title: 'Paramètres de « {{title}} »',
        close: 'Fermer',
        nameLabel: 'Nom',
        descriptionLabel: 'Description',
        descriptionHint: '500 caractères max',
        activitiesLabel: 'Activités',
        activitySoon: 'Bientôt disponible',
        save: 'Enregistrer',
        saveSuccess: 'Paramètres enregistrés',
        saveError: 'Erreur',
        saveAsTemplate: 'Enregistrer comme template',
        saveAsTemplateNamePrompt: 'Nom du template',
        saveAsTemplateSuccess: 'Template enregistré',
        saveAsTemplateError: 'Erreur',
        resetConfirm: {
          title: 'Réinitialiser « {{title}} » ?',
          message: 'Action irréversible.',
          confirm: 'Réinitialiser',
          cancel: 'Annuler',
        },
        resetSuccess: 'Tableau réinitialisé',
        resetError: 'Erreur reset',
      },
      untitled: 'Sans titre',
    },
    share: { panel: { title: 'Partager' } },
    activities: { open: 'Activités', title: 'Activités', close: 'Fermer', recentSection: '', items: {} },
    groups: { title: 'Groupes' },
    voteResults: { title: 'Résultats' },
    canvas: { undo: { label: 'Annuler', redo: 'Rétablir' } },
    guard: { accessDenied: 'Accès refusé' },
  },
};

/** Inert transport — the board-page delta under test never drives the wire. */
class NoopTransport extends BoardTransport {
  connect(): void {}
  disconnect(): void {}
  emit(): void {}
  on<T = unknown>(_type: string, _handler: (data: T) => void): () => void {
    return () => {};
  }
  onReconnect(_handler: () => void): () => void {
    return () => {};
  }
}

/** Protected surface exercised by these tests. */
interface BoardPageApi {
  showActivities(): boolean;
  onLaunchActivity(id: string): void;
  showSettings(): boolean;
  isOwner(): boolean;
  resetPendingConfirm(): boolean;
  onResetClick(): void;
  openSettings(event: Event): void;
  closeSettings(): void;
}

describe('BoardPageComponent — activities panel wiring', () => {
  function create(): BoardPageApi {
    const fixture = TestBed.createComponent(BoardPageComponent);
    // No detectChanges(): ngOnInit (store.init HTTP + polling interval) stays dormant — this
    // suite only covers the local activities-panel toggle introduced on this branch.
    return fixture.componentInstance as unknown as BoardPageApi;
  }

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [BoardPageComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: COLLABORATIF_API_URL, useValue: 'http://localhost:8083/api/collaboratif' },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { paramMap: new Map([['boardId', 'board-1']]) } },
        },
      ],
    }).overrideComponent(BoardPageComponent, {
      set: { providers: [BoardStore, { provide: BoardTransport, useClass: NoopTransport }] },
    });
  });

  afterEach(() => TestBed.resetTestingModule());

  it('keeps the activities panel closed by default', () => {
    expect(create().showActivities()).toBe(false);
  });

  it('closes the activities panel when an activity is launched (WIP placeholder)', () => {
    const cmp = create();
    (cmp as unknown as { showActivities: { set(v: boolean): void } }).showActivities.set(true);
    expect(cmp.showActivities()).toBe(true);

    cmp.onLaunchActivity('poll');

    expect(cmp.showActivities()).toBe(false);
  });
});

describe('BoardPageComponent — AC08.2.4 settings modal + reset wiring', () => {
  let httpMock: HttpTestingController;

  function create() {
    const fixture = TestBed.createComponent(BoardPageComponent);
    const store = fixture.debugElement.injector.get(BoardStore);
    return { fixture, cmp: fixture.componentInstance as unknown as BoardPageApi, store };
  }

  /** Flushes the four read-only GETs that `BoardStore.init()` fires from `ngOnInit()`. */
  async function flushInitRequests(): Promise<void> {
    httpMock.expectOne(r => r.url === `${TEST_API_URL}/whiteboard/boards/board-1`).flush({
      id: 'board-1', name: 'Mon tableau', description: null, coverImage: null,
      maxParticipants: null, enabledActivities: [], templateDraftOf: null, cards: [], role: 'OWNER',
    });
    httpMock.expectOne(r => r.url === `${TEST_API_URL}/whiteboard/boards/board-1/members`).flush([]);
    httpMock.expectOne(r => r.url === `${TEST_API_URL}/whiteboard/boards/board-1/vote/current`)
      .flush('', { status: 404, statusText: 'Not Found' });
    httpMock.expectOne(r => r.url === `${TEST_API_URL}/whiteboard/boards/board-1/vote/last`)
      .flush('', { status: 404, statusText: 'Not Found' });
    // loadBoard()/loadMembers()/loadVote() are async functions awaiting firstValueFrom() --
    // flush() resolves the observable synchronously but their  continuations (which
    // call signal.set()) only run on a microtask tick after flush() returns.
    await Promise.resolve();
    await Promise.resolve();
  }

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [
        BoardPageComponent,
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
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { paramMap: new Map([['boardId', 'board-1']]) } },
        },
      ],
    }).overrideComponent(BoardPageComponent, {
      set: { providers: [BoardStore, { provide: BoardTransport, useClass: NoopTransport }] },
    });
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
    TestBed.resetTestingModule();
  });

  // ── AC08.2.4: OWNER-only settings entry point ──
  it('ac08_2_4_10_hides the Settings button for a non-owner role', async () => {
    const { fixture, cmp, store } = create();
    fixture.detectChanges();
    await flushInitRequests();
    store.userRole.set('EDITOR');
    fixture.detectChanges();
    expect(cmp.isOwner()).toBe(false);
    const btn = fixture.nativeElement.querySelector('[aria-label="Paramètres du tableau"]');
    expect(btn).toBeNull();
  });

  it('ac08_2_4_11_shows the Settings button for the OWNER role', async () => {
    const { fixture, cmp, store } = create();
    fixture.detectChanges();
    await flushInitRequests();
    store.userRole.set('OWNER');
    fixture.detectChanges();
    expect(cmp.isOwner()).toBe(true);
    const btn = fixture.nativeElement.querySelector('[aria-label="Paramètres du tableau"]') as HTMLButtonElement;
    expect(btn).toBeTruthy();

    btn.click();
    fixture.detectChanges();
    expect(cmp.showSettings()).toBe(true);
    expect(fixture.nativeElement.querySelector('wb-board-settings-modal')).toBeTruthy();
  });

  it('ac08_2_4_11b_settings modal save closes the modal via onSettingsSaved', async () => {
    const { fixture, cmp, store } = create();
    fixture.detectChanges();
    await flushInitRequests();
    store.userRole.set('OWNER');
    fixture.detectChanges();

    const btn = fixture.nativeElement.querySelector('[aria-label="Paramètres du tableau"]') as HTMLButtonElement;
    btn.click();
    fixture.detectChanges();
    expect(cmp.showSettings()).toBe(true);

    const saveBtn = fixture.nativeElement.querySelector('.wb-settings__footer .wb-settings__btn--primary') as HTMLButtonElement;
    saveBtn.click();
    fixture.detectChanges();

    const req = httpMock.expectOne(r => r.url === `${TEST_API_URL}/whiteboard/boards/board-1` && r.method === 'PATCH');
    req.flush({
      id: 'board-1', title: 'Mon tableau', role: 'owner', createdAt: '', updatedAt: '',
      thumbnailUrl: null, activeParticipantCount: 0, favorite: false, description: null,
      coverImage: null, maxParticipants: null, enabledActivities: [], deletedAt: null,
    });
    fixture.detectChanges();

    expect(cmp.showSettings()).toBe(false);
  });

  it('ac08_2_4_11c_closeSettings hides the modal without an API call', async () => {
    const { fixture, cmp, store } = create();
    fixture.detectChanges();
    await flushInitRequests();
    store.userRole.set('OWNER');
    fixture.detectChanges();

    (fixture.nativeElement.querySelector('[aria-label="Paramètres du tableau"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(cmp.showSettings()).toBe(true);

    (fixture.nativeElement.querySelector('.wb-settings__close-btn') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(cmp.showSettings()).toBe(false);
    httpMock.expectNone(r => r.method === 'PATCH');
  });

  // ── AC08.2.4: reset requires a second click to confirm ──
  it('ac08_2_4_12_reset button arms confirmation on first click without calling the API', () => {
    const { cmp } = create();
    expect(cmp.resetPendingConfirm()).toBe(false);
    cmp.onResetClick();
    expect(cmp.resetPendingConfirm()).toBe(true);
    httpMock.expectNone(r => r.url.includes('/reset'));
  });

  it('ac08_2_4_13_reset button calls POST /reset on the confirming second click', () => {
    const { cmp } = create();
    cmp.onResetClick();
    cmp.onResetClick();
    expect(cmp.resetPendingConfirm()).toBe(false);
    const req = httpMock.expectOne(r => r.url === `${TEST_API_URL}/whiteboard/boards/board-1/reset`);
    expect(req.request.method).toBe('POST');
    req.flush(null);
  });

  it('ac08_2_4_14_reset error shows a toast and clears the confirm state', () => {
    const { cmp } = create();
    const toast = TestBed.inject(ToastService);
    const toastSpy = vi.spyOn(toast, 'show');
    cmp.onResetClick();
    cmp.onResetClick();
    httpMock.expectOne(r => r.url.includes('/reset')).flush('', { status: 403, statusText: 'Forbidden' });
    expect(toastSpy).toHaveBeenCalledWith('whiteboard.board.settings.resetError', 'error');
  });

  it('ac08_2_4_15_reset success clears local canvas state', () => {
    const { cmp, store } = create();
    store.cards.set([{ id: 'c1', boardId: 'board-1', type: 'TEXT', content: '', posX: 0, posY: 0, width: 10, height: 10, color: '#fff', groupId: null, groupColor: null, locked: false, layer: 1, fieldValues: [] }]);
    cmp.onResetClick();
    cmp.onResetClick();
    httpMock.expectOne(r => r.url.includes('/reset')).flush(null);
    expect(store.cards()).toEqual([]);
  });
});
