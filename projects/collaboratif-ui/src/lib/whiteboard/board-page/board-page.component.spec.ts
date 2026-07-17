import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ActivatedRoute, Router, provideRouter } from '@angular/router';
import { TranslocoTestingModule } from '@jsverse/transloco';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { BoardPageComponent } from './board-page.component';
import { BoardStore } from '../../core/whiteboard/board.store';
import { BoardTransport } from '../../core/whiteboard/board-transport';
import { ToastService } from '../../core/toast/toast.service';
import { COLLABORATIF_API_URL } from '../../core/whiteboard/config/tokens';
import type { Card } from '../model/board.types';
import type { ToolMode } from '../model/tools';

/** Inert transport for the shortcut suite — it never opens a room. */
class NoopKeyTransport extends BoardTransport {
  connect(): void {}
  disconnect(): void {}
  emit(): void {}
  on<T = unknown>(_type: string, _handler: (data: T) => void): () => void {
    return () => {};
  }
  onReconnect(): () => void {
    return () => {};
  }
  getSessionId(): string {
    return 'noop-key-transport';
  }
}

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
      backToList: 'Retour à la liste des tableaux',
    },
    share: { panel: { title: 'Partager' } },
    activities: { open: 'Activités', title: 'Activités', close: 'Fermer', recentSection: '', items: {} },
    groups: { title: 'Groupes' },
    voteResults: { title: 'Résultats' },
    connector: {
      style: {
        title: 'Style du connecteur',
        shapeLabel: 'Forme',
        shape: { straight: 'Droit', curved: 'Courbe', orthogonal: 'Orthogonal' },
        arrowLabel: 'Flèche',
        arrow: { none: 'Aucune', start: 'Début', end: 'Fin', both: 'Deux extrémités' },
        dashedLabel: 'Pointillé',
        widthLabel: 'Épaisseur',
        colorLabel: 'Couleur',
        labelFieldLabel: 'Étiquette',
        labelPlaceholder: 'Texte du connecteur',
      },
    },
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
  getSessionId(): string {
    return 'noop-session';
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
        provideRouter([]),
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
  /** Fake `Router` provider (not `provideRouter()`+`vi.spyOn`) — avoids monkey-patching the
   *  real `Router` class prototype, which is shared across test files within a worker and
   *  previously leaked into unrelated specs (whiteboard-sync.service.spec.ts's RxStomp mocks). */
  let navigateSpy: ReturnType<typeof vi.fn>;

  function create() {
    const fixture = TestBed.createComponent(BoardPageComponent);
    const store = fixture.debugElement.injector.get(BoardStore);
    return { fixture, cmp: fixture.componentInstance as unknown as BoardPageApi, store };
  }

  /** Flushes the four read-only GETs that `BoardStore.init()` fires from `ngOnInit()`. */
  async function flushInitRequests(): Promise<void> {
    httpMock.expectOne(r => r.url === `${TEST_API_URL}/whiteboard/boards/board-1`).flush({
      id: 'board-1', title: 'Mon tableau', description: null, coverImage: null,
      maxParticipants: null, enabledActivities: [], role: 'OWNER',
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
    navigateSpy = vi.fn().mockResolvedValue(true);
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
        { provide: Router, useValue: { navigateByUrl: navigateSpy } },
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
    vi.restoreAllMocks();
  });

  // ── F2: real board title in the H1 (not the untitled fallback) ──
  it('f2_renders the real board title in the H1 once loadBoard resolves', async () => {
    const { fixture } = create();
    fixture.detectChanges();
    await flushInitRequests();
    fixture.detectChanges();
    const h1 = fixture.nativeElement.querySelector('h1.wb-page__title') as HTMLElement;
    expect(h1.textContent?.trim()).toBe('Mon tableau');
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

  // US08.2.4 recette — the modal persists through BoardService directly, so onSettingsSaved must
  // push the saved values back into the store; otherwise the H1 title and a reopened modal show
  // stale data until a full page reload.
  it('ac08_2_4_11d_settings save syncs the saved title/description into the store', async () => {
    const { fixture, store } = create();
    fixture.detectChanges();
    await flushInitRequests();
    store.userRole.set('OWNER');
    fixture.detectChanges();

    (fixture.nativeElement.querySelector('[aria-label="Paramètres du tableau"]') as HTMLButtonElement).click();
    fixture.detectChanges();

    (fixture.nativeElement.querySelector('.wb-settings__footer .wb-settings__btn--primary') as HTMLButtonElement).click();
    fixture.detectChanges();

    httpMock
      .expectOne(r => r.url === `${TEST_API_URL}/whiteboard/boards/board-1` && r.method === 'PATCH')
      .flush({
        id: 'board-1', title: 'Titre révisé', role: 'owner', createdAt: '', updatedAt: '',
        thumbnailUrl: null, activeParticipantCount: 0, favorite: false,
        description: 'Description révisée', coverImage: null, maxParticipants: null,
        enabledActivities: [], deletedAt: null,
      });
    fixture.detectChanges();

    expect(store.board()?.name).toBe('Titre révisé');
    expect(store.board()?.description).toBe('Description révisée');
    // The H1 reflects the new title without a reload.
    expect((fixture.nativeElement.querySelector('h1.wb-page__title') as HTMLElement).textContent?.trim())
      .toBe('Titre révisé');
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

  it('back button navigates to the boards list (/whiteboard)', async () => {
    const { fixture } = create();
    fixture.detectChanges();
    await flushInitRequests();
    fixture.detectChanges();
    const back = fixture.nativeElement.querySelector(
      '[aria-label="Retour à la liste des tableaux"]',
    ) as HTMLButtonElement;
    expect(back).toBeTruthy();
    back.click();
    expect(navigateSpy).toHaveBeenCalledWith('/whiteboard');
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

  // ── US08.3.2b AC5: BoardStore now performs the fail-closed access check that
  // `boardAccessGuard` used to perform behind a blocking route guard — the canvas mounts
  // immediately (no more pre-render blocking) and this reactively toasts + redirects once
  // the same GET call resolves as a denial.
  it('ac_us08_3_2b_toasts_and_redirects_to_whiteboard_list_when_the_board_get_returns_403', async () => {
    // Fake timers around the exchange: `loadBoard()`'s GET is wrapped in `timeout(...)`
    // (LOAD_BOARD_TIMEOUT_MS) — on the real clock, RxJS's `timeout` operator schedules a
    // real macrotask that must be neutralized here, or it can fire seconds later during a
    // *different* spec file's tests (this project's Vitest config runs files un-isolated —
    // `--isolate` defaults to false — so a stray real timer is not confined to this file).
    vi.useFakeTimers();
    try {
      const { fixture, store } = create();
      fixture.detectChanges();
      const toast = TestBed.inject(ToastService);
      const toastSpy = vi.spyOn(toast, 'show');

      httpMock
        .expectOne(r => r.url === `${TEST_API_URL}/whiteboard/boards/board-1`)
        .flush('', { status: 403, statusText: 'Forbidden' });
      httpMock.expectOne(r => r.url === `${TEST_API_URL}/whiteboard/boards/board-1/members`).flush([]);
      httpMock
        .expectOne(r => r.url === `${TEST_API_URL}/whiteboard/boards/board-1/vote/current`)
        .flush('', { status: 404, statusText: 'Not Found' });
      httpMock
        .expectOne(r => r.url === `${TEST_API_URL}/whiteboard/boards/board-1/vote/last`)
        .flush('', { status: 404, statusText: 'Not Found' });
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(0);

      expect(store.accessDenied()).toBe(true);
      expect(toastSpy).toHaveBeenCalledWith('whiteboard.guard.accessDenied', 'error');
      expect(navigateSpy).toHaveBeenCalledWith('/whiteboard');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('BoardPageComponent — US08.7.1 keyboard delete of a selected connector (A11y)', () => {
  /** Exposes the protected `document:keydown` host listener for direct invocation, the same
   *  cast-and-call pattern used elsewhere in this repo for protected interaction handlers
   *  (e.g. `whiteboard-canvas.component.spec.ts`'s `component['onKeyDown'](...)`). */
  interface KeydownApi {
    onKeydown(event: KeyboardEvent): void;
  }

  /** Records every outbound `emit(type, data)` call — like the store's own delete-of-a-card
   *  path, `deleteConnection` fires `connection:delete` and only removes the connection from
   *  local state once the server echoes back `connection:deleted` (see `board.store.spec.ts`
   *  for the reconciliation itself); this transport double lets the test observe that emit
   *  without needing a full echo round-trip. */
  class RecordingTransport extends BoardTransport {
    readonly emitted: Array<{ type: string; data: unknown }> = [];
    connect(): void {}
    disconnect(): void {}
    emit(type: string, data: unknown): void {
      this.emitted.push({ type, data });
    }
    on<T = unknown>(_type: string, _handler: (data: T) => void): () => void {
      return () => {};
    }
    onReconnect(): () => void {
      return () => {};
    }
    getSessionId(): string {
      return 'recording-transport-session';
    }
  }

  function create() {
    const fixture = TestBed.createComponent(BoardPageComponent);
    const store = fixture.debugElement.injector.get(BoardStore);
    const transport = fixture.debugElement.injector.get(BoardTransport) as RecordingTransport;
    return { cmp: fixture.componentInstance as unknown as KeydownApi, store, transport };
  }

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [BoardPageComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: COLLABORATIF_API_URL, useValue: TEST_API_URL },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { paramMap: new Map([['boardId', 'board-1']]) } },
        },
      ],
    }).overrideComponent(BoardPageComponent, {
      set: { providers: [BoardStore, { provide: BoardTransport, useClass: RecordingTransport }] },
    });
  });

  afterEach(() => TestBed.resetTestingModule());

  /** `onKeydown` reads `event.target` (to skip input/textarea focus) before anything else —
   *  a synthetic `KeyboardEvent` built with `new KeyboardEvent(...)` (not dispatched through
   *  the DOM) has a `null` target, so it is stubbed here to a plain, non-editable element. */
  function keydownEvent(key: string): KeyboardEvent {
    const event = new KeyboardEvent('keydown', { key });
    Object.defineProperty(event, 'target', { value: document.createElement('div') });
    return event;
  }

  it('Delete emits connection:delete for a selected connector, no card selected, no hover required', () => {
    const { cmp, store, transport } = create();
    store.connections.set([
      { id: 'conn-1', boardId: 'board-1', fromId: 'c1', toId: 'c2', label: null, color: null, shape: 'curved', arrow: 'none', dashed: false, lineStyle: 'solid', startCap: 'none', endCap: 'none', width: 2 },
    ]);
    store.selectCards(new Set(['conn-1']));

    cmp.onKeydown(keydownEvent('Delete'));

    expect(transport.emitted.some((e) => e.type === 'connection:delete' && (e.data as { id: string }).id === 'conn-1')).toBe(
      true,
    );
    expect(store.selectedIds().size).toBe(0);
  });

  it('Backspace also emits connection:delete for a selected connector', () => {
    const { cmp, store, transport } = create();
    store.connections.set([
      { id: 'conn-1', boardId: 'board-1', fromId: 'c1', toId: 'c2', label: null, color: null, shape: 'curved', arrow: 'none', dashed: false, lineStyle: 'solid', startCap: 'none', endCap: 'none', width: 2 },
    ]);
    store.selectCards(new Set(['conn-1']));

    cmp.onKeydown(keydownEvent('Backspace'));

    expect(transport.emitted.some((e) => e.type === 'connection:delete' && (e.data as { id: string }).id === 'conn-1')).toBe(
      true,
    );
  });

  /** Same as {@link keydownEvent} with the Ctrl modifier — `onKeydown` treats Ctrl and Meta alike. */
  function modKeydownEvent(key: string): KeyboardEvent {
    const event = new KeyboardEvent('keydown', { key, ctrlKey: true });
    Object.defineProperty(event, 'target', { value: document.createElement('div') });
    return event;
  }

  function cutCard(id: string): Card {
    return {
      id,
      boardId: 'board-1',
      type: 'TEXT',
      content: 'a',
      color: '#FEF08A',
      posX: 0,
      posY: 0,
      width: 192,
      height: 128,
      layer: 1,
      locked: false,
      groupId: null,
      groupColor: null,
    } as Card;
  }

  // Ctrl+X was the one clipboard shortcut missing next to Ctrl+C / Ctrl+V / Ctrl+D.
  it('Ctrl+X puts the selection on the clipboard and removes it from the board', () => {
    const { cmp, store, transport } = create();
    localStorage.clear();
    store.cards.set([cutCard('card-1')]);
    store.selectCards(new Set(['card-1']));

    cmp.onKeydown(modKeydownEvent('x'));

    expect(store.clipboard()).toHaveLength(1);
    expect(transport.emitted.some((e) => e.type === 'card:delete' && (e.data as { id: string }).id === 'card-1')).toBe(true);
  });

  it('Ctrl+X does nothing when the selection is empty', () => {
    const { cmp, store, transport } = create();
    localStorage.clear();
    store.clipboard.set([]);
    store.selectCards(new Set());
    const before = transport.emitted.length;

    cmp.onKeydown(modKeydownEvent('x'));

    expect(store.clipboard()).toHaveLength(0);
    expect(transport.emitted).toHaveLength(before);
  });
});

describe('BoardPageComponent — connector style panel wiring (US08.7.2)', () => {
  /** Records every outbound `emit(type, data)` call — lets the test observe the
   *  `connection:update` payload the style panel produces end-to-end through the store. */
  class RecordingTransport extends BoardTransport {
    readonly emitted: Array<{ type: string; data: unknown }> = [];
    connect(): void {}
    disconnect(): void {}
    emit(type: string, data: unknown): void {
      this.emitted.push({ type, data });
    }
    on<T = unknown>(_type: string, _handler: (data: T) => void): () => void {
      return () => {};
    }
    onReconnect(): () => void {
      return () => {};
    }
    getSessionId(): string {
      return 'connector-style-transport-session';
    }
  }

  let httpMock: HttpTestingController;

  function create() {
    const fixture = TestBed.createComponent(BoardPageComponent);
    const store = fixture.debugElement.injector.get(BoardStore);
    const transport = fixture.debugElement.injector.get(BoardTransport) as RecordingTransport;
    return { fixture, store, transport };
  }

  /** Flushes the four read-only GETs that `BoardStore.init()` fires from `ngOnInit()`. */
  async function flushInitRequests(): Promise<void> {
    httpMock.expectOne((r) => r.url === `${TEST_API_URL}/whiteboard/boards/board-1`).flush({
      id: 'board-1', title: 'Mon tableau', description: null, coverImage: null,
      maxParticipants: null, enabledActivities: [], role: 'OWNER',
    });
    httpMock.expectOne((r) => r.url === `${TEST_API_URL}/whiteboard/boards/board-1/members`).flush([]);
    httpMock.expectOne((r) => r.url === `${TEST_API_URL}/whiteboard/boards/board-1/vote/current`)
      .flush('', { status: 404, statusText: 'Not Found' });
    httpMock.expectOne((r) => r.url === `${TEST_API_URL}/whiteboard/boards/board-1/vote/last`)
      .flush('', { status: 404, statusText: 'Not Found' });
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
        provideRouter([]),
        { provide: COLLABORATIF_API_URL, useValue: TEST_API_URL },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { paramMap: new Map([['boardId', 'board-1']]) } },
        },
      ],
    }).overrideComponent(BoardPageComponent, {
      set: { providers: [BoardStore, { provide: BoardTransport, useClass: RecordingTransport }] },
    });
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
    TestBed.resetTestingModule();
  });

  /** `selectedConnection` is protected — read through a cast, like the other suites here. */
  function cmpOf(fixture: ComponentFixture<BoardPageComponent>): { selectedConnection(): unknown } {
    return fixture.componentInstance as unknown as { selectedConnection(): unknown };
  }

  it('offers the link style in the bottom bar when exactly one connector is selected', async () => {
    const { fixture, store } = create();
    fixture.detectChanges();
    await flushInitRequests();
    store.connections.set([
      { id: 'conn-1', boardId: 'board-1', fromId: 'c1', toId: 'c2', label: null, color: null, shape: 'curved', arrow: 'none', dashed: false, lineStyle: 'solid', startCap: 'none', endCap: 'none', width: 2 },
    ]);
    store.selectCards(new Set(['conn-1']));
    fixture.detectChanges();

    // The style lives in the selection bar now — the corner panel is gone (recette 2026-07-17:
    // « Je ne veux pas de la div wb-connector-style (…) tout dans le menu du bas »).
    expect(fixture.nativeElement.querySelector('wb-selection-toolbar')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('wb-connector-style-panel')).toBeNull();
  });

  it('offers no link style when nothing, or more than one item, is selected', async () => {
    const { fixture, store } = create();
    fixture.detectChanges();
    await flushInitRequests();
    store.connections.set([
      { id: 'conn-1', boardId: 'board-1', fromId: 'c1', toId: 'c2', label: null, color: null, shape: 'curved', arrow: 'none', dashed: false, lineStyle: 'solid', startCap: 'none', endCap: 'none', width: 2 },
    ]);
    fixture.detectChanges();
    expect(cmpOf(fixture).selectedConnection()).toBeNull();

    store.selectCards(new Set(['conn-1', 'some-card']));
    fixture.detectChanges();
    expect(cmpOf(fixture).selectedConnection()).toBeNull();
  });

  it('offers no link style when the lone selected id is a card, not a connector', async () => {
    const { fixture, store } = create();
    fixture.detectChanges();
    await flushInitRequests();
    store.cards.set([
      { id: 'card-a', boardId: 'board-1', type: 'TEXT', content: '', posX: 0, posY: 0, width: 10, height: 10, color: '#fff', groupId: null, groupColor: null, locked: false, layer: 1, fieldValues: [] },
    ]);
    store.selectCards(new Set(['card-a']));
    fixture.detectChanges();

    expect(cmpOf(fixture).selectedConnection()).toBeNull();
  });

  /**
   * The panel's `<select>` is gone (recette: everything moved to the bottom bar), but its contract
   * has not: a style change emits a patch carrying *only* the field touched — never a whole
   * connector — so two people restyling the same link cannot clobber each other's other fields.
   */
  it('emits connection:update with only the field that changed, through the store', async () => {
    const { fixture, store, transport } = create();
    fixture.detectChanges();
    await flushInitRequests();
    store.connections.set([
      { id: 'conn-1', boardId: 'board-1', fromId: 'c1', toId: 'c2', label: null, color: null, shape: 'curved', arrow: 'none', dashed: false, lineStyle: 'solid', startCap: 'none', endCap: 'none', width: 2 },
    ]);
    store.selectCards(new Set(['conn-1']));
    fixture.detectChanges();

    (fixture.componentInstance as unknown as { onConnectorStyleChange(id: string, p: unknown): void })
      .onConnectorStyleChange('conn-1', { shape: 'orthogonal' });
    fixture.detectChanges();

    const emitted = transport.emitted.filter((e) => e.type === 'connection:update');
    expect(emitted).toHaveLength(1);
    expect(emitted[0].data).toEqual({ id: 'conn-1', boardId: 'board-1', shape: 'orthogonal' });
    expect(store.connections().find((c) => c.id === 'conn-1')?.shape).toBe('orthogonal');
  });
});

/**
 * Bare-letter tool shortcuts + the `?` cheat-sheet.
 *
 * Reported in recette alongside the tooltip gap: the toolbar was reachable by mouse only. No bare
 * letter was bound anywhere on the board before this, so the whole A–Z space was free to take.
 */
describe('BoardPageComponent — tool keyboard shortcuts', () => {
  interface ShortcutApi {
    onKeydown(event: KeyboardEvent): void;
    tool: { (): ToolMode; set(v: ToolMode): void };
    showShortcuts: { (): boolean; set(v: boolean): void };
  }

  function create() {
    const fixture = TestBed.createComponent(BoardPageComponent);
    const store = fixture.debugElement.injector.get(BoardStore);
    return { cmp: fixture.componentInstance as unknown as ShortcutApi, store };
  }

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [BoardPageComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: COLLABORATIF_API_URL, useValue: TEST_API_URL },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { paramMap: new Map([['boardId', 'board-1']]) } },
        },
      ],
    }).overrideComponent(BoardPageComponent, {
      set: { providers: [BoardStore, { provide: BoardTransport, useClass: NoopKeyTransport }] },
    });
  });

  afterEach(() => TestBed.resetTestingModule());

  /** A keydown whose target is a plain, non-editable element (see the sibling suite's note). */
  function key(k: string, init: KeyboardEventInit = {}): KeyboardEvent {
    const event = new KeyboardEvent('keydown', { key: k, ...init });
    Object.defineProperty(event, 'target', { value: document.createElement('div') });
    return event;
  }

  it.each([
    ['v', 'select'],
    ['h', 'pan'],
    ['n', 'sticky'],
    ['t', 'text'],
    ['c', 'frame'],
    ['r', 'rect'],
    ['o', 'circle'],
    ['l', 'line'],
    ['p', 'draw'],
    ['f', 'link-cards'],
  ])('«%s» activates the %s tool', (pressed, expected) => {
    const { cmp } = create();
    cmp.tool.set('select');

    cmp.onKeydown(key(pressed));

    expect(cmp.tool()).toBe(expected);
  });

  it('accepts an uppercase letter — Shift must not defeat the shortcut', () => {
    const { cmp } = create();

    cmp.onKeydown(key('N', { shiftKey: true }));

    expect(cmp.tool()).toBe('sticky');
  });

  /** The whole point of gating on the modifier: Ctrl+P is the browser's print, not the pencil. */
  it.each([
    ['p', { ctrlKey: true }],
    ['p', { metaKey: true }],
    ['v', { ctrlKey: true }],
    ['n', { altKey: true }],
  ])('ignores «%s» when a modifier is held', (pressed, init) => {
    const { cmp } = create();
    cmp.tool.set('table');

    cmp.onKeydown(key(pressed, init));

    expect(cmp.tool()).toBe('table');
  });

  it('ignores a shortcut typed into an input, so text entry is never hijacked', () => {
    const { cmp } = create();
    cmp.tool.set('select');
    const event = new KeyboardEvent('keydown', { key: 'n' });
    Object.defineProperty(event, 'target', { value: document.createElement('input') });

    cmp.onKeydown(event);

    expect(cmp.tool()).toBe('select');
  });

  it('does not switch tool on a read-only board, where no tool can place anything', () => {
    const { cmp, store } = create();
    store.userRole.set('VIEWER');
    cmp.tool.set('select');

    cmp.onKeydown(key('n'));

    expect(cmp.tool()).toBe('select');
  });

  it('« ? » toggles the cheat-sheet open, then closed', () => {
    const { cmp } = create();

    cmp.onKeydown(key('?'));
    expect(cmp.showShortcuts()).toBe(true);

    cmp.onKeydown(key('?'));
    expect(cmp.showShortcuts()).toBe(false);
  });

  /** The cheat-sheet is the topmost layer: Escape must close it before touching the selection. */
  it('Escape closes the cheat-sheet first, and only then clears the selection', () => {
    const { cmp, store } = create();
    store.selectCards(new Set(['card-1']));
    cmp.showShortcuts.set(true);

    cmp.onKeydown(key('Escape'));
    expect(cmp.showShortcuts()).toBe(false);
    expect(store.selectedIds().size).toBe(1);

    cmp.onKeydown(key('Escape'));
    expect(store.selectedIds().size).toBe(0);
  });
});

/**
 * Contextual hint for the active tool.
 *
 * Moved out of the toolbar (recette: « wb-toolbar__hint je pense que ca n'a rien a faire la (…)
 * dans cet espace cela élargi la bar d'outil et ce n'est pas tres beau ») — the bar is ~50px wide
 * and the hint needs ~180px. It is board chrome, so it lives on the board.
 */
describe('BoardPageComponent — contextual tool hint', () => {
  interface HintApi {
    tool: { set(v: ToolMode): void };
    hintKey(): string | null;
  }

  function create() {
    const fixture = TestBed.createComponent(BoardPageComponent);
    return { fixture, cmp: fixture.componentInstance as unknown as HintApi };
  }

  beforeEach(() => {
    TestBed.configureTestingModule({
      // The only suite here that renders the template — hence Transloco, for the `| transloco` pipe.
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
        provideRouter([]),
        { provide: COLLABORATIF_API_URL, useValue: TEST_API_URL },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { paramMap: new Map([['boardId', 'board-1']]) } },
        },
      ],
    }).overrideComponent(BoardPageComponent, {
      set: { providers: [BoardStore, { provide: BoardTransport, useClass: NoopKeyTransport }] },
    });
  });

  afterEach(() => TestBed.resetTestingModule());

  it('names what the active tool does', () => {
    const { cmp } = create();
    cmp.tool.set('frame');

    expect(cmp.hintKey()).toBe('whiteboard.toolbar.hint.frame');
  });

  /** Every shape shares one hint — "drag to draw the shape" holds for all six. */
  it('uses the shared shape hint for any SHAPE tool', () => {
    const { cmp } = create();
    cmp.tool.set('triangle');

    expect(cmp.hintKey()).toBe('whiteboard.toolbar.hint.shape');
  });

  it('shows no hint on select, which needs no explanation', () => {
    const { cmp } = create();
    cmp.tool.set('select');

    expect(cmp.hintKey()).toBeNull();
  });

  /** It must never eat a pointer gesture aimed at the canvas underneath. */
  it('renders outside the toolbar and never intercepts pointer events', () => {
    const { fixture, cmp } = create();
    cmp.tool.set('draw');
    fixture.detectChanges();

    const hint = fixture.nativeElement.querySelector('.wb-page__hint') as HTMLElement;
    expect(hint).toBeTruthy();
    expect(hint.closest('.wb-toolbar')).toBeNull();
    expect(getComputedStyle(hint).pointerEvents).toBe('none');
  });
});
