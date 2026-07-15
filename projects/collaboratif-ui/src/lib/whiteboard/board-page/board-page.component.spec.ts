import { TestBed } from '@angular/core/testing';
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
      { id: 'conn-1', boardId: 'board-1', fromId: 'c1', toId: 'c2', label: null, color: null, shape: 'curved', arrow: 'none', dashed: false, width: 2 },
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
      { id: 'conn-1', boardId: 'board-1', fromId: 'c1', toId: 'c2', label: null, color: null, shape: 'curved', arrow: 'none', dashed: false, width: 2 },
    ]);
    store.selectCards(new Set(['conn-1']));

    cmp.onKeydown(keydownEvent('Backspace'));

    expect(transport.emitted.some((e) => e.type === 'connection:delete' && (e.data as { id: string }).id === 'conn-1')).toBe(
      true,
    );
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

  it('shows the style panel when exactly one connector is selected', async () => {
    const { fixture, store } = create();
    fixture.detectChanges();
    await flushInitRequests();
    store.connections.set([
      { id: 'conn-1', boardId: 'board-1', fromId: 'c1', toId: 'c2', label: null, color: null, shape: 'curved', arrow: 'none', dashed: false, width: 2 },
    ]);
    store.selectCards(new Set(['conn-1']));
    fixture.detectChanges();

    const panel = fixture.nativeElement.querySelector('wb-connector-style-panel');
    expect(panel).toBeTruthy();
    const aside = fixture.nativeElement.querySelector('[aria-label="Style du connecteur"]');
    expect(aside).toBeTruthy();
  });

  it('hides the style panel when nothing, or more than one item, is selected', async () => {
    const { fixture, store } = create();
    fixture.detectChanges();
    await flushInitRequests();
    store.connections.set([
      { id: 'conn-1', boardId: 'board-1', fromId: 'c1', toId: 'c2', label: null, color: null, shape: 'curved', arrow: 'none', dashed: false, width: 2 },
    ]);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('wb-connector-style-panel')).toBeNull();

    store.selectCards(new Set(['conn-1', 'some-card']));
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('wb-connector-style-panel')).toBeNull();
  });

  it('hides the style panel when the lone selected id is a card, not a connector', async () => {
    const { fixture, store } = create();
    fixture.detectChanges();
    await flushInitRequests();
    store.cards.set([
      { id: 'card-a', boardId: 'board-1', type: 'TEXT', content: '', posX: 0, posY: 0, width: 10, height: 10, color: '#fff', groupId: null, groupColor: null, locked: false, layer: 1, fieldValues: [] },
    ]);
    store.selectCards(new Set(['card-a']));
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('wb-connector-style-panel')).toBeNull();
  });

  it('changing the shape select in the panel emits connection:update with only {shape} through the store', async () => {
    const { fixture, store, transport } = create();
    fixture.detectChanges();
    await flushInitRequests();
    store.connections.set([
      { id: 'conn-1', boardId: 'board-1', fromId: 'c1', toId: 'c2', label: null, color: null, shape: 'curved', arrow: 'none', dashed: false, width: 2 },
    ]);
    store.selectCards(new Set(['conn-1']));
    fixture.detectChanges();

    const select = fixture.nativeElement.querySelector('#wbConnStyleShape') as HTMLSelectElement;
    select.value = 'orthogonal';
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    const emitted = transport.emitted.filter((e) => e.type === 'connection:update');
    expect(emitted).toHaveLength(1);
    expect(emitted[0].data).toEqual({ id: 'conn-1', boardId: 'board-1', shape: 'orthogonal' });
    expect(store.connections().find((c) => c.id === 'conn-1')?.shape).toBe('orthogonal');
  });
});
