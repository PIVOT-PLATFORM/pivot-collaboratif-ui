import { ComponentFixture, TestBed } from '@angular/core/testing';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideRouter, Router } from '@angular/router';
import { TranslocoTestingModule } from '@jsverse/transloco';
import { BoardListComponent } from './board-list.component';
import { ToastService } from '../../core/toast/toast.service';
import { Board, BoardPage, WhiteboardTemplate } from '../../core/whiteboard/board.model';
import { COLLABORATIF_API_URL } from '../../core/whiteboard/config/tokens';

const TEST_API_URL = 'http://localhost:8083/api/collaboratif';
const BASE = `${TEST_API_URL}/whiteboard/boards`;
const TEMPLATES_BASE = `${TEST_API_URL}/whiteboard/templates`;

const FR_TRANSLATIONS = {
  whiteboard: {
    board: {
      list: {
        title: 'Mes tableaux',
        newBoard: 'Nouveau tableau',
        emptyTitle: 'Aucun tableau',
        emptySubtitle: 'Créez votre premier tableau',
        emptyCta: 'Créer mon premier tableau',
        loadMore: 'Charger plus',
        retry: 'Réessayer',
        errorSubtitle: 'Impossible de charger',
        createError: 'Impossible de créer le tableau',
        online: 'en ligne',
        role: { owner: 'Propriétaire', editor: 'Éditeur', viewer: 'Lecteur' },
        menu: { rename: 'Renommer', delete: 'Supprimer' },
        create: {
          title: 'Nouveau tableau',
          label: 'Titre du tableau',
          placeholder: 'Mon tableau',
          confirm: 'Créer',
          cancel: 'Annuler',
        },
        aria: {
          openBoard: '{{title}} — {{date}} — {{role}}',
          boardMenu: 'Actions pour {{title}}',
          activeParticipants: '{{count}} en ligne',
        },
      },
      rename: {
        error: 'Impossible de renommer le tableau',
        aria: 'Renommer le tableau {{title}}',
      },
      delete: {
        success: 'Tableau supprimé',
        error: 'Impossible de supprimer le tableau',
        confirm: {
          title: 'Supprimer « {{title}} » ?',
          message: 'Cette action est irréversible.',
          confirm: 'Supprimer définitivement',
          cancel: 'Annuler',
        },
      },
      favorite: {
        add: 'Ajouter {{title}} aux favoris',
        remove: 'Retirer {{title}} des favoris',
        error: 'Impossible de mettre à jour les favoris',
      },
      trash: {
        tab: 'Corbeille',
        empty: 'Corbeille vide',
        deletedOn: 'Supprimé le {{date}}',
        restore: 'Restaurer',
        restoreAria: 'Restaurer {{title}}',
        restoreSuccess: 'Tableau restauré',
        restoreError: 'Impossible de restaurer le tableau',
        purge: 'Supprimer définitivement',
        purgeAria: 'Supprimer définitivement {{title}}',
        purgeSuccess: 'Tableau supprimé définitivement',
        purgeError: 'Impossible de supprimer définitivement le tableau',
        purgeConfirm: {
          title: 'Supprimer définitivement « {{title}} » ?',
          message: 'Action irréversible.',
          confirm: 'Supprimer définitivement',
          cancel: 'Annuler',
        },
      },
      search: {
        label: 'Rechercher un tableau',
        placeholder: 'Rechercher par nom ou description…',
        clear: 'Effacer la recherche',
        noResults: 'Aucun résultat pour « {{term}} »',
        resultsCount: '{{count}} résultat(s)',
      },
    },
    template: {
      gallery: {
        label: 'Modèle de tableau',
        loadError: 'Impossible de charger les modèles de tableau.',
        retry: 'Réessayer',
      },
      createError: 'Impossible de créer le tableau. Veuillez réessayer.',
      previewAlt: 'Aperçu du modèle {{name}}',
      brainstorm: { name: 'Brainstorm', description: 'Idées libres sur des post-its.' },
      retrospective: { name: 'Rétrospective', description: 'Ce qui a bien fonctionné, ce qui peut s\'améliorer.' },
      userStoryMap: { name: 'User Story Map', description: 'Parcours utilisateur et priorisation.' },
    },
  },
};

function makeBoard(overrides: Partial<Board> = {}): Board {
  return {
    id: 'board-1',
    title: 'Mon tableau',
    role: 'owner',
    createdAt: '2026-07-01T10:00:00Z',
    updatedAt: '2026-07-07T10:00:00Z',
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

function makePageResponse(boards: Board[], hasNext = false): BoardPage {
  return {
    boards,
    totalElements: boards.length,
    totalPages: hasNext ? 2 : 1,
    currentPage: 0,
    hasNext,
  };
}

function makeTemplates(): WhiteboardTemplate[] {
  return [
    { id: 'tpl-brainstorm', code: 'BRAINSTORM', thumbnailUrl: 'https://cdn.example.com/brainstorm.png' },
    { id: 'tpl-retro', code: 'RETROSPECTIVE', thumbnailUrl: 'https://cdn.example.com/retro.png' },
    { id: 'tpl-usm', code: 'USER_STORY_MAP', thumbnailUrl: 'https://cdn.example.com/usm.png' },
  ];
}

describe('BoardListComponent', () => {
  let fixture: ComponentFixture<BoardListComponent>;
  let httpMock: HttpTestingController;
  let router: Router;
  let toastService: ToastService;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [
        BoardListComponent,
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
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(BoardListComponent);
    httpMock = TestBed.inject(HttpTestingController);
    router = TestBed.inject(Router);
    toastService = TestBed.inject(ToastService);
    fixture.detectChanges();
  });

  afterEach(() => {
    httpMock.verify();
    TestBed.resetTestingModule();
  });

  /**
   * Opens the "Nouveau tableau" modal via the given trigger selector and flushes the
   * template gallery's GET request it fires on init (default: 3 templates, "Brainstorm"
   * selected by default). Pass `templates: []` and rely on the caller to flush an error
   * response instead when testing the gallery's error state.
   */
  function openCreateModal(
    triggerSelector = '.board-list__create-btn',
    templates: WhiteboardTemplate[] | 'error' = makeTemplates(),
  ): void {
    (fixture.nativeElement.querySelector(triggerSelector) as HTMLButtonElement).click();
    fixture.detectChanges();
    if (templates === 'error') {
      httpMock.expectOne(TEMPLATES_BASE).flush('', { status: 500, statusText: 'Server Error' });
    } else {
      httpMock.expectOne(TEMPLATES_BASE).flush(templates);
    }
    fixture.detectChanges();
  }

  // ── Loading state ──
  it('renders skeleton grid while loading', () => {
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('[aria-busy="true"]')).toBeTruthy();
    expect(el.querySelectorAll('.board-list__skeleton').length).toBe(8);
    httpMock.expectOne(r => r.url === BASE).flush(makePageResponse([]));
    fixture.detectChanges();
  });

  // ── Success state ──
  it('renders board cards on successful load', () => {
    const boards = [makeBoard({ id: '1', title: 'Alpha' }), makeBoard({ id: '2', title: 'Beta' })];
    httpMock.expectOne(r => r.url === BASE).flush(makePageResponse(boards));
    fixture.detectChanges();

    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelectorAll('.board-list__card').length).toBe(2);
    expect(el.textContent).toContain('Alpha');
    expect(el.textContent).toContain('Beta');
  });

  // ── Empty state ──
  it('renders empty state when no boards returned', () => {
    httpMock.expectOne(r => r.url === BASE).flush(makePageResponse([]));
    fixture.detectChanges();

    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('.board-list__empty')).toBeTruthy();
    expect(el.querySelector('.board-list__grid')).toBeNull();
  });

  // ── Error state ──
  it('renders error state and retry button on HTTP failure', () => {
    httpMock.expectOne(r => r.url === BASE).flush('', { status: 500, statusText: 'Error' });
    fixture.detectChanges();

    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('[role="alert"]')).toBeTruthy();
    expect(el.querySelector('.board-list__retry-btn')).toBeTruthy();
  });

  it('retry button reloads boards', () => {
    httpMock.expectOne(r => r.url === BASE).flush('', { status: 500, statusText: 'Error' });
    fixture.detectChanges();

    (fixture.nativeElement.querySelector('.board-list__retry-btn') as HTMLButtonElement).click();
    fixture.detectChanges();

    httpMock.expectOne(r => r.url === BASE).flush(makePageResponse([makeBoard()]));
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.board-list__card')).toBeTruthy();
  });

  // ── Board navigation ──
  it('card link href contains board id', () => {
    httpMock.expectOne(r => r.url === BASE).flush(makePageResponse([makeBoard({ id: 'abc-123' })]));
    fixture.detectChanges();

    const link = fixture.nativeElement.querySelector('.board-list__card-link') as HTMLAnchorElement;
    expect(link.getAttribute('href')).toContain('abc-123');
  });

  // ── Create modal ──
  it('opens create modal when "Nouveau tableau" button clicked', () => {
    httpMock.expectOne(r => r.url === BASE).flush(makePageResponse([]));
    fixture.detectChanges();

    openCreateModal();

    expect(fixture.nativeElement.querySelector('[role="dialog"]')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('#board-title-input')).toBeTruthy();
  });

  it('closes modal when cancel button clicked', () => {
    httpMock.expectOne(r => r.url === BASE).flush(makePageResponse([]));
    fixture.detectChanges();

    openCreateModal();

    (fixture.nativeElement.querySelector('.board-list__modal-btn--cancel') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[role="dialog"]')).toBeNull();
  });

  it('submits create board and navigates on success', async () => {
    httpMock.expectOne(r => r.url === BASE).flush(makePageResponse([]));
    fixture.detectChanges();

    openCreateModal();

    const input = fixture.nativeElement.querySelector('#board-title-input') as HTMLInputElement;
    input.value = 'Nouveau test';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    const spy = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    (fixture.nativeElement.querySelector('.board-list__modal-btn--confirm') as HTMLButtonElement).click();
    fixture.detectChanges();

    const createReq = httpMock.expectOne(r => r.url === BASE && r.method === 'POST');
    expect(createReq.request.body).toEqual({ title: 'Nouveau test' });
    // "Brainstorm" is selected by default once the gallery loads (see openCreateModal()).
    expect(createReq.request.params.get('templateId')).toBe('tpl-brainstorm');
    createReq.flush(makeBoard({ id: 'new-id', title: 'Nouveau test' }));
    fixture.detectChanges();

    expect(spy).toHaveBeenCalledWith(['/whiteboard', 'new-id']);
    spy.mockRestore();
  });

  it('shows toast on create board failure', () => {
    httpMock.expectOne(r => r.url === BASE).flush(makePageResponse([]));
    fixture.detectChanges();

    const toastSpy = vi.spyOn(toastService, 'show');
    openCreateModal();

    const input = fixture.nativeElement.querySelector('#board-title-input') as HTMLInputElement;
    input.value = 'Fail board';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    (fixture.nativeElement.querySelector('.board-list__modal-btn--confirm') as HTMLButtonElement).click();
    fixture.detectChanges();

    httpMock.expectOne(r => r.url === BASE && r.method === 'POST')
      .flush('', { status: 500, statusText: 'Error' });
    fixture.detectChanges();

    expect(toastSpy).toHaveBeenCalledWith('whiteboard.board.list.createError', 'error');
  });

  it('shows inline error message and retry button on create failure, without closing the modal', () => {
    httpMock.expectOne(r => r.url === BASE).flush(makePageResponse([]));
    fixture.detectChanges();

    openCreateModal();

    const input = fixture.nativeElement.querySelector('#board-title-input') as HTMLInputElement;
    input.value = 'Fail board';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    (fixture.nativeElement.querySelector('.board-list__modal-btn--confirm') as HTMLButtonElement).click();
    fixture.detectChanges();

    httpMock.expectOne(r => r.url === BASE && r.method === 'POST')
      .flush('', { status: 500, statusText: 'Error' });
    fixture.detectChanges();

    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('[role="dialog"]')).toBeTruthy();
    expect(el.querySelector('.board-list__modal-error[role="alert"]')).toBeTruthy();
    const retryBtn = el.querySelector('.board-list__modal-error .board-list__retry-btn') as HTMLButtonElement;
    expect(retryBtn).toBeTruthy();

    const spy = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    retryBtn.click();
    fixture.detectChanges();
    httpMock.expectOne(r => r.url === BASE && r.method === 'POST')
      .flush(makeBoard({ id: 'retry-id', title: 'Fail board' }));
    fixture.detectChanges();

    expect(spy).toHaveBeenCalledWith(['/whiteboard', 'retry-id']);
    spy.mockRestore();
  });

  it('falls back to a blank ("Vierge") board when the template gallery fails to load', () => {
    httpMock.expectOne(r => r.url === BASE).flush(makePageResponse([]));
    fixture.detectChanges();

    openCreateModal('.board-list__create-btn', 'error');

    const input = fixture.nativeElement.querySelector('#board-title-input') as HTMLInputElement;
    input.value = 'Board vierge malgré erreur templates';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    const spy = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    (fixture.nativeElement.querySelector('.board-list__modal-btn--confirm') as HTMLButtonElement).click();
    fixture.detectChanges();

    const createReq = httpMock.expectOne(r => r.url === BASE && r.method === 'POST');
    expect(createReq.request.params.has('templateId')).toBe(false);
    createReq.flush(makeBoard({ id: 'blank-id', title: 'Board vierge malgré erreur templates' }));
    fixture.detectChanges();

    expect(spy).toHaveBeenCalledWith(['/whiteboard', 'blank-id']);
    spy.mockRestore();
  });

  it('creates the board from the template picked in the gallery', () => {
    httpMock.expectOne(r => r.url === BASE).flush(makePageResponse([]));
    fixture.detectChanges();

    openCreateModal();

    const el: HTMLElement = fixture.nativeElement;
    const cards = Array.from(el.querySelectorAll<HTMLButtonElement>('.template-gallery__card'));
    const retroCard = cards.find(c => c.textContent?.includes('Rétrospective'))!;
    retroCard.click();
    fixture.detectChanges();

    const input = el.querySelector('#board-title-input') as HTMLInputElement;
    input.value = 'Depuis retro';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    const spy = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    (el.querySelector('.board-list__modal-btn--confirm') as HTMLButtonElement).click();
    fixture.detectChanges();

    const createReq = httpMock.expectOne(r => r.url === BASE && r.method === 'POST');
    expect(createReq.request.params.get('templateId')).toBe('tpl-retro');
    createReq.flush(makeBoard({ id: 'from-retro', title: 'Depuis retro' }));
    fixture.detectChanges();

    expect(spy).toHaveBeenCalledWith(['/whiteboard', 'from-retro']);
    spy.mockRestore();
  });

  // ── Pagination ──
  it('does not show "Charger plus" when hasNext is false', () => {
    httpMock.expectOne(r => r.url === BASE).flush(makePageResponse([makeBoard()]));
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.board-list__load-more-btn')).toBeNull();
  });

  it('shows "Charger plus" and appends boards on click', () => {
    const firstPage = makePageResponse([makeBoard({ id: '1', title: 'First' })], true);
    httpMock.expectOne(r => r.url === BASE).flush(firstPage);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.board-list__load-more-btn')).toBeTruthy();
    (fixture.nativeElement.querySelector('.board-list__load-more-btn') as HTMLButtonElement).click();
    fixture.detectChanges();

    const secondPage: BoardPage = {
      boards: [makeBoard({ id: '2', title: 'Second' })],
      totalElements: 2,
      totalPages: 2,
      currentPage: 1,
      hasNext: false,
    };
    httpMock.expectOne(r => r.url === BASE && r.params.get('page') === '1').flush(secondPage);
    fixture.detectChanges();

    const cards = fixture.nativeElement.querySelectorAll('.board-list__card');
    expect(cards.length).toBe(2);
    expect(fixture.nativeElement.querySelector('.board-list__load-more-btn')).toBeNull();
  });

  // ── Participants badge ──
  it('shows online badge when activeParticipantCount > 0', () => {
    httpMock.expectOne(r => r.url === BASE).flush(
      makePageResponse([makeBoard({ activeParticipantCount: 3 })]),
    );
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.board-list__badge--online')).toBeTruthy();
  });

  it('hides online badge when activeParticipantCount is 0', () => {
    httpMock.expectOne(r => r.url === BASE).flush(
      makePageResponse([makeBoard({ activeParticipantCount: 0 })]),
    );
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.board-list__badge--online')).toBeNull();
  });

  // ── Menu ──
  it('toggles per-card menu on menu button click', () => {
    httpMock.expectOne(r => r.url === BASE).flush(makePageResponse([makeBoard({ id: 'x' })]));
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('[role="menu"]')).toBeNull();

    const menuBtn = fixture.nativeElement.querySelector('.board-list__card-menu-btn') as HTMLButtonElement;
    menuBtn.click();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('[role="menu"]')).toBeTruthy();
    expect(menuBtn.getAttribute('aria-expanded')).toBe('true');

    menuBtn.click();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[role="menu"]')).toBeNull();
  });

  // ── Thumbnail ──
  it('renders thumbnail img when thumbnailUrl is present', () => {
    httpMock.expectOne(r => r.url === BASE).flush(
      makePageResponse([makeBoard({ thumbnailUrl: 'https://example.com/thumb.png' })]),
    );
    fixture.detectChanges();
    const img = fixture.nativeElement.querySelector('.board-list__card-thumbnail') as HTMLImageElement;
    expect(img).toBeTruthy();
    expect(img.src).toContain('thumb.png');
  });

  it('renders placeholder when thumbnailUrl is null', () => {
    httpMock.expectOne(r => r.url === BASE).flush(
      makePageResponse([makeBoard({ thumbnailUrl: null })]),
    );
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.board-list__card-thumbnail-placeholder')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('.board-list__card-thumbnail')).toBeNull();
  });

  // ── Card aria-label ──
  it('card link has aria-label containing board title', () => {
    httpMock.expectOne(r => r.url === BASE).flush(
      makePageResponse([makeBoard({ title: 'Tableau secret' })]),
    );
    fixture.detectChanges();
    const link = fixture.nativeElement.querySelector('.board-list__card-link') as HTMLAnchorElement;
    expect(link.getAttribute('aria-label')).toContain('Tableau secret');
  });

  // ── Rename ──
  it('rename menu item shows inline input with current title', () => {
    httpMock.expectOne(r => r.url === BASE).flush(makePageResponse([makeBoard({ id: 'r1', title: 'Mon board' })]));
    fixture.detectChanges();

    (fixture.nativeElement.querySelector('.board-list__card-menu-btn') as HTMLButtonElement).click();
    fixture.detectChanges();

    (fixture.nativeElement.querySelectorAll('.board-list__menu-item')[0] as HTMLButtonElement).click();
    fixture.detectChanges();

    const input = fixture.nativeElement.querySelector('.board-list__card-rename-input') as HTMLInputElement;
    expect(input).toBeTruthy();
    expect(input.value).toBe('Mon board');
    expect(fixture.nativeElement.querySelector('.board-list__card-link')).toBeNull();
  });

  it('Escape key cancels rename and restores card link', () => {
    httpMock.expectOne(r => r.url === BASE).flush(makePageResponse([makeBoard({ id: 'r2', title: 'Mon board' })]));
    fixture.detectChanges();

    (fixture.nativeElement.querySelector('.board-list__card-menu-btn') as HTMLButtonElement).click();
    fixture.detectChanges();
    (fixture.nativeElement.querySelectorAll('.board-list__menu-item')[0] as HTMLButtonElement).click();
    fixture.detectChanges();

    const input = fixture.nativeElement.querySelector('.board-list__card-rename-input') as HTMLInputElement;
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.board-list__card-rename-input')).toBeNull();
    expect(fixture.nativeElement.querySelector('.board-list__card-link')).toBeTruthy();
  });

  it('Enter key confirms rename and updates board title on success', () => {
    httpMock.expectOne(r => r.url === BASE).flush(makePageResponse([makeBoard({ id: 'r3', title: 'Ancien' })]));
    fixture.detectChanges();

    (fixture.nativeElement.querySelector('.board-list__card-menu-btn') as HTMLButtonElement).click();
    fixture.detectChanges();
    (fixture.nativeElement.querySelectorAll('.board-list__menu-item')[0] as HTMLButtonElement).click();
    fixture.detectChanges();

    const input = fixture.nativeElement.querySelector('.board-list__card-rename-input') as HTMLInputElement;
    input.value = 'Nouveau nom';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.board-list__card-rename-spinner')).not.toBeNull();

    const patchReq = httpMock.expectOne(r => r.url.includes('/r3') && r.method === 'PATCH');
    expect(patchReq.request.body).toEqual({ title: 'Nouveau nom' });
    patchReq.flush(makeBoard({ id: 'r3', title: 'Nouveau nom' }));
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.board-list__card-rename-input')).toBeNull();
    expect(fixture.nativeElement.textContent).toContain('Nouveau nom');
  });

  it('rename error shows toast and closes rename mode', () => {
    httpMock.expectOne(r => r.url === BASE).flush(makePageResponse([makeBoard({ id: 'r4', title: 'Board' })]));
    fixture.detectChanges();

    const toastSpy = vi.spyOn(toastService, 'show');
    (fixture.nativeElement.querySelector('.board-list__card-menu-btn') as HTMLButtonElement).click();
    fixture.detectChanges();
    (fixture.nativeElement.querySelectorAll('.board-list__menu-item')[0] as HTMLButtonElement).click();
    fixture.detectChanges();

    const input = fixture.nativeElement.querySelector('.board-list__card-rename-input') as HTMLInputElement;
    input.value = 'Nouveau';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    fixture.detectChanges();

    httpMock.expectOne(r => r.url.includes('/r4') && r.method === 'PATCH')
      .flush('', { status: 403, statusText: 'Forbidden' });
    fixture.detectChanges();

    expect(toastSpy).toHaveBeenCalledWith('whiteboard.board.rename.error', 'error');
    expect(fixture.nativeElement.querySelector('.board-list__card-rename-input')).toBeNull();
  });

  // ── Delete ──
  it('delete menu item opens confirm alertdialog', () => {
    httpMock.expectOne(r => r.url === BASE).flush(makePageResponse([makeBoard({ id: 'd1', title: 'A supprimer' })]));
    fixture.detectChanges();

    (fixture.nativeElement.querySelector('.board-list__card-menu-btn') as HTMLButtonElement).click();
    fixture.detectChanges();
    (fixture.nativeElement.querySelectorAll('.board-list__menu-item')[1] as HTMLButtonElement).click();
    fixture.detectChanges();

    const dialog = fixture.nativeElement.querySelector('[role="alertdialog"]') as HTMLElement;
    expect(dialog).not.toBeNull();
    expect(dialog.textContent).toContain('A supprimer');
    expect(dialog.textContent).toContain('Supprimer définitivement');
  });

  it('cancel in delete dialog closes dialog without HTTP call', () => {
    httpMock.expectOne(r => r.url === BASE).flush(makePageResponse([makeBoard({ id: 'd2', title: 'Board D2' })]));
    fixture.detectChanges();

    (fixture.nativeElement.querySelector('.board-list__card-menu-btn') as HTMLButtonElement).click();
    fixture.detectChanges();
    (fixture.nativeElement.querySelectorAll('.board-list__menu-item')[1] as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('[role="alertdialog"]')).not.toBeNull();

    (fixture.nativeElement.querySelector('.board-list__modal-btn--cancel') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('[role="alertdialog"]')).toBeNull();
    // afterEach(httpMock.verify()) would fail if a DELETE was accidentally sent
    expect(fixture.nativeElement.textContent).toContain('Board D2');
  });

  it('confirm delete removes the card on success and shows toast', () => {
    httpMock.expectOne(r => r.url === BASE).flush(makePageResponse([makeBoard({ id: 'd3', title: 'Board D3' })]));
    fixture.detectChanges();

    const toastSpy = vi.spyOn(toastService, 'show');
    (fixture.nativeElement.querySelector('.board-list__card-menu-btn') as HTMLButtonElement).click();
    fixture.detectChanges();
    (fixture.nativeElement.querySelectorAll('.board-list__menu-item')[1] as HTMLButtonElement).click();
    fixture.detectChanges();

    (fixture.nativeElement.querySelector('.board-list__modal-btn--delete') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.board-list__card-rename-spinner')).not.toBeNull();

    httpMock.expectOne(r => r.url.includes('/d3') && r.method === 'DELETE').flush(null);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('[role="alertdialog"]')).toBeNull();
    expect(fixture.nativeElement.textContent).not.toContain('Board D3');
    expect(toastSpy).toHaveBeenCalledWith('whiteboard.board.delete.success', 'success');
  });

  it('confirm delete shows error toast and keeps card on failure', () => {
    httpMock.expectOne(r => r.url === BASE).flush(makePageResponse([makeBoard({ id: 'd4', title: 'Board D4' })]));
    fixture.detectChanges();

    const toastSpy = vi.spyOn(toastService, 'show');
    (fixture.nativeElement.querySelector('.board-list__card-menu-btn') as HTMLButtonElement).click();
    fixture.detectChanges();
    (fixture.nativeElement.querySelectorAll('.board-list__menu-item')[1] as HTMLButtonElement).click();
    fixture.detectChanges();

    (fixture.nativeElement.querySelector('.board-list__modal-btn--delete') as HTMLButtonElement).click();
    fixture.detectChanges();

    httpMock.expectOne(r => r.url.includes('/d4') && r.method === 'DELETE')
      .flush('', { status: 403, statusText: 'Forbidden' });
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('[role="alertdialog"]')).toBeNull();
    expect(fixture.nativeElement.textContent).toContain('Board D4');
    expect(toastSpy).toHaveBeenCalledWith('whiteboard.board.delete.error', 'error');
  });

  // ── Empty state CTA ──
  it('empty state CTA opens create modal', () => {
    httpMock.expectOne(r => r.url === BASE).flush(makePageResponse([]));
    fixture.detectChanges();

    openCreateModal('.board-list__empty-cta');

    expect(fixture.nativeElement.querySelector('[role="dialog"]')).toBeTruthy();
    httpMock.expectNone(r => r.url === BASE); // no additional HTTP call on modal open
  });

  // ── AC08.1.6: favorites ──
  it('ac08_1_6_06_favorite star toggles aria-pressed and calls PUT on activation', () => {
    httpMock.expectOne(r => r.url === BASE).flush(makePageResponse([makeBoard({ id: 'f1', favorite: false })]));
    fixture.detectChanges();

    const star = fixture.nativeElement.querySelector('.board-list__favorite-btn') as HTMLButtonElement;
    expect(star.getAttribute('aria-pressed')).toBe('false');

    star.click();
    fixture.detectChanges();
    expect(star.getAttribute('aria-pressed')).toBe('true');

    const req = httpMock.expectOne(r => r.url === `${BASE}/f1/favorite` && r.method === 'PUT');
    req.flush(null);
  });

  it('ac08_1_6_07_favorite star toggles off and calls DELETE when already favorite', () => {
    httpMock.expectOne(r => r.url === BASE).flush(makePageResponse([makeBoard({ id: 'f2', favorite: true })]));
    fixture.detectChanges();

    const star = fixture.nativeElement.querySelector('.board-list__favorite-btn') as HTMLButtonElement;
    star.click();
    fixture.detectChanges();
    expect(star.getAttribute('aria-pressed')).toBe('false');

    const req = httpMock.expectOne(r => r.url === `${BASE}/f2/favorite` && r.method === 'DELETE');
    req.flush(null);
  });

  it('ac08_1_6_08_favorites are sorted first, then by updatedAt DESC within each group', () => {
    const boards = [
      makeBoard({ id: 'a', title: 'A', favorite: false, updatedAt: '2026-07-10T00:00:00Z' }),
      makeBoard({ id: 'b', title: 'B', favorite: true, updatedAt: '2026-07-01T00:00:00Z' }),
      makeBoard({ id: 'c', title: 'C', favorite: true, updatedAt: '2026-07-05T00:00:00Z' }),
    ];
    httpMock.expectOne(r => r.url === BASE).flush(makePageResponse(boards));
    fixture.detectChanges();

    const el1: HTMLElement = fixture.nativeElement;
    const nodeList1: NodeListOf<HTMLElement> = el1.querySelectorAll('.board-list__card-title');
    const titles = Array.from(nodeList1).map((node: HTMLElement) => node.textContent?.trim());
    expect(titles).toEqual(['C', 'B', 'A']);
  });

  it('ac08_1_6_09_toggling a favorite re-sorts the list immediately without a server reload', () => {
    const boards = [
      makeBoard({ id: 'x', title: 'X', favorite: false, updatedAt: '2026-07-10T00:00:00Z' }),
      makeBoard({ id: 'y', title: 'Y', favorite: false, updatedAt: '2026-07-05T00:00:00Z' }),
    ];
    httpMock.expectOne(r => r.url === BASE).flush(makePageResponse(boards));
    fixture.detectChanges();

    const stars = fixture.nativeElement.querySelectorAll('.board-list__favorite-btn');
    (stars[1] as HTMLButtonElement).click(); // favorite "Y" (currently second)
    fixture.detectChanges();

    const el2: HTMLElement = fixture.nativeElement;
    const nodeList2: NodeListOf<HTMLElement> = el2.querySelectorAll('.board-list__card-title');
    const titles = Array.from(nodeList2).map((node: HTMLElement) => node.textContent?.trim());
    expect(titles).toEqual(['Y', 'X']);
    httpMock.expectOne(r => r.url === `${BASE}/y/favorite` && r.method === 'PUT').flush(null);
  });

  it('ac08_1_6_10_favorite toggle rolls back on error and shows a toast (no unconfirmed optimistic state)', () => {
    httpMock.expectOne(r => r.url === BASE).flush(makePageResponse([makeBoard({ id: 'f3', favorite: false })]));
    fixture.detectChanges();

    const toastSpy = vi.spyOn(toastService, 'show');
    const star = fixture.nativeElement.querySelector('.board-list__favorite-btn') as HTMLButtonElement;
    star.click();
    fixture.detectChanges();
    expect(star.getAttribute('aria-pressed')).toBe('true');

    httpMock.expectOne(r => r.url === `${BASE}/f3/favorite` && r.method === 'PUT')
      .flush('', { status: 500, statusText: 'Error' });
    fixture.detectChanges();

    expect(star.getAttribute('aria-pressed')).toBe('false');
    expect(toastSpy).toHaveBeenCalledWith('whiteboard.board.favorite.error', 'error');
  });

  it('ac08_1_6_11_favorite star has an accessible aria-label reflecting current state', () => {
    httpMock.expectOne(r => r.url === BASE).flush(makePageResponse([makeBoard({ id: 'f4', title: 'Perso', favorite: false })]));
    fixture.detectChanges();
    const star = fixture.nativeElement.querySelector('.board-list__favorite-btn') as HTMLButtonElement;
    expect(star.getAttribute('aria-label')).toContain('Perso');
  });

  // ── AC08.1.8: search ──
  it('ac08_1_8_03_typing in the search field is debounced before requesting q', async () => {
    httpMock.expectOne(r => r.url === BASE).flush(makePageResponse([makeBoard({ id: 's1', title: 'Alpha' })]));
    fixture.detectChanges();

    const input = fixture.nativeElement.querySelector('#board-search-input') as HTMLInputElement;
    input.value = 'al';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    httpMock.expectNone(r => r.params.has('q'));

    await new Promise((r) => setTimeout(r, 350));
    fixture.detectChanges();
    const req = httpMock.expectOne(r => r.url === BASE && r.params.get('q') === 'al');
    req.flush(makePageResponse([makeBoard({ id: 's1', title: 'Alpha' })]));
  });

  it('ac08_1_8_04_clearing the search reloads the unfiltered list', async () => {
    httpMock.expectOne(r => r.url === BASE).flush(makePageResponse([makeBoard({ id: 's2', title: 'Beta' })]));
    fixture.detectChanges();

    const input = fixture.nativeElement.querySelector('#board-search-input') as HTMLInputElement;
    input.value = 'be';
    input.dispatchEvent(new Event('input'));
    await new Promise((r) => setTimeout(r, 350));
    fixture.detectChanges();
    httpMock.expectOne(r => r.params.get('q') === 'be').flush(makePageResponse([makeBoard({ id: 's2', title: 'Beta' })]));
    fixture.detectChanges();

    (fixture.nativeElement.querySelector('.board-list__search-clear') as HTMLButtonElement).click();
    await new Promise((r) => setTimeout(r, 350));
    fixture.detectChanges();
    const req = httpMock.expectOne(r => r.url === BASE);
    expect(req.request.params.has('q')).toBe(false);
    req.flush(makePageResponse([makeBoard({ id: 's2', title: 'Beta' })]));
  });

  it('ac08_1_8_05_shows "no results" state distinct from the empty state when search matches nothing', async () => {
    httpMock.expectOne(r => r.url === BASE).flush(makePageResponse([]));
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.board-list__empty-cta')).toBeTruthy(); // plain empty state

    const input = fixture.nativeElement.querySelector('#board-search-input') as HTMLInputElement;
    input.value = 'zzz';
    input.dispatchEvent(new Event('input'));
    await new Promise((r) => setTimeout(r, 350));
    fixture.detectChanges();
    httpMock.expectOne(r => r.params.get('q') === 'zzz').flush(makePageResponse([]));
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Aucun résultat pour « zzz »');
    expect(fixture.nativeElement.querySelector('.board-list__empty-cta')).toBeNull();
  });

  // ── AC08.1.7: trash tab ──
  it('ac08_1_7_10_switching to the Corbeille tab requests trashed=true', () => {
    httpMock.expectOne(r => r.url === BASE).flush(makePageResponse([]));
    fixture.detectChanges();

    const tabs = fixture.nativeElement.querySelectorAll('.board-list__tab');
    (tabs[1] as HTMLButtonElement).click();
    fixture.detectChanges();

    const req = httpMock.expectOne(r => r.url === BASE && r.params.get('trashed') === 'true');
    req.flush(makePageResponse([makeBoard({ id: 't1', title: 'Corbeille board', deletedAt: '2026-07-10T00:00:00Z' })]));
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Corbeille board');
    expect(fixture.nativeElement.querySelector('.board-list__trash-actions')).toBeTruthy();
  });

  it('ac08_1_7_11_trash empty state shows "Corbeille vide"', () => {
    httpMock.expectOne(r => r.url === BASE).flush(makePageResponse([]));
    fixture.detectChanges();

    (fixture.nativeElement.querySelectorAll('.board-list__tab')[1] as HTMLButtonElement).click();
    fixture.detectChanges();
    httpMock.expectOne(r => r.params.get('trashed') === 'true').flush(makePageResponse([]));
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Corbeille vide');
  });

  it('ac08_1_7_12_restore button calls POST restore and removes the board from the trash view', () => {
    httpMock.expectOne(r => r.url === BASE).flush(makePageResponse([]));
    fixture.detectChanges();
    (fixture.nativeElement.querySelectorAll('.board-list__tab')[1] as HTMLButtonElement).click();
    fixture.detectChanges();
    httpMock.expectOne(r => r.params.get('trashed') === 'true')
      .flush(makePageResponse([makeBoard({ id: 't2', title: 'À restaurer' })]));
    fixture.detectChanges();

    const restoreBtn = Array.from(fixture.nativeElement.querySelectorAll('.board-list__trash-actions button'))[0] as HTMLButtonElement;
    restoreBtn.click();
    fixture.detectChanges();

    const req = httpMock.expectOne(r => r.url === `${BASE}/t2/restore` && r.method === 'POST');
    req.flush(null);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).not.toContain('À restaurer');
  });

  it('ac08_1_7_13_restore error shows a toast and keeps the board listed in the trash', () => {
    httpMock.expectOne(r => r.url === BASE).flush(makePageResponse([]));
    fixture.detectChanges();
    (fixture.nativeElement.querySelectorAll('.board-list__tab')[1] as HTMLButtonElement).click();
    fixture.detectChanges();
    httpMock.expectOne(r => r.params.get('trashed') === 'true')
      .flush(makePageResponse([makeBoard({ id: 't3', title: 'Reste en corbeille' })]));
    fixture.detectChanges();

    const toastSpy = vi.spyOn(toastService, 'show');
    const restoreBtn = Array.from(fixture.nativeElement.querySelectorAll('.board-list__trash-actions button'))[0] as HTMLButtonElement;
    restoreBtn.click();
    httpMock.expectOne(r => r.url === `${BASE}/t3/restore`).flush('', { status: 500, statusText: 'Error' });
    fixture.detectChanges();

    expect(toastSpy).toHaveBeenCalledWith('whiteboard.board.trash.restoreError', 'error');
    expect(fixture.nativeElement.textContent).toContain('Reste en corbeille');
  });

  it('ac08_1_7_14_purge button opens a confirm dialog before calling DELETE permanent', () => {
    httpMock.expectOne(r => r.url === BASE).flush(makePageResponse([]));
    fixture.detectChanges();
    (fixture.nativeElement.querySelectorAll('.board-list__tab')[1] as HTMLButtonElement).click();
    fixture.detectChanges();
    httpMock.expectOne(r => r.params.get('trashed') === 'true')
      .flush(makePageResponse([makeBoard({ id: 't4', title: 'À purger' })]));
    fixture.detectChanges();

    const purgeBtn = fixture.nativeElement.querySelector('.board-list__trash-purge-trigger') as HTMLButtonElement;
    purgeBtn.click();
    fixture.detectChanges();

    const dialog = fixture.nativeElement.querySelector('[role="alertdialog"]') as HTMLElement;
    expect(dialog).toBeTruthy();
    expect(dialog.textContent).toContain('À purger');
    httpMock.expectNone(r => r.url.includes('/permanent'));

    (dialog.querySelector('.board-list__modal-btn--delete') as HTMLButtonElement).click();
    fixture.detectChanges();
    const req = httpMock.expectOne(r => r.url === `${BASE}/t4/permanent` && r.method === 'DELETE');
    req.flush(null);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).not.toContain('À purger');
  });

  it('ac08_1_7_15_cancel on the purge dialog does not call the API', () => {
    httpMock.expectOne(r => r.url === BASE).flush(makePageResponse([]));
    fixture.detectChanges();
    (fixture.nativeElement.querySelectorAll('.board-list__tab')[1] as HTMLButtonElement).click();
    fixture.detectChanges();
    httpMock.expectOne(r => r.params.get('trashed') === 'true')
      .flush(makePageResponse([makeBoard({ id: 't5', title: 'Garder' })]));
    fixture.detectChanges();

    const purgeBtn = fixture.nativeElement.querySelector('.board-list__trash-purge-trigger') as HTMLButtonElement;
    purgeBtn.click();
    fixture.detectChanges();
    (fixture.nativeElement.querySelector('[role="alertdialog"] .board-list__modal-btn--cancel') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('[role="alertdialog"]')).toBeNull();
    expect(fixture.nativeElement.textContent).toContain('Garder');
  });

  it('ac08_1_7_16_clicking the already-active tab is a no-op (no reload)', () => {
    httpMock.expectOne(r => r.url === BASE).flush(makePageResponse([makeBoard({ id: 'noop1' })]));
    fixture.detectChanges();

    (fixture.nativeElement.querySelectorAll('.board-list__tab')[0] as HTMLButtonElement).click();
    fixture.detectChanges();
    httpMock.expectNone(() => true);
  });

  it('ac08_1_7_17_purge error shows a toast and keeps the board listed in the trash', () => {
    httpMock.expectOne(r => r.url === BASE).flush(makePageResponse([]));
    fixture.detectChanges();
    (fixture.nativeElement.querySelectorAll('.board-list__tab')[1] as HTMLButtonElement).click();
    fixture.detectChanges();
    httpMock.expectOne(r => r.params.get('trashed') === 'true')
      .flush(makePageResponse([makeBoard({ id: 't6', title: 'Purge échoue' })]));
    fixture.detectChanges();

    const toastSpy = vi.spyOn(toastService, 'show');
    (fixture.nativeElement.querySelector('.board-list__trash-purge-trigger') as HTMLButtonElement).click();
    fixture.detectChanges();
    (fixture.nativeElement.querySelector('[role="alertdialog"] .board-list__modal-btn--delete') as HTMLButtonElement).click();
    fixture.detectChanges();

    httpMock.expectOne(r => r.url === `${BASE}/t6/permanent`).flush('', { status: 403, statusText: 'Forbidden' });
    fixture.detectChanges();

    expect(toastSpy).toHaveBeenCalledWith('whiteboard.board.trash.purgeError', 'error');
    expect(fixture.nativeElement.querySelector('[role="alertdialog"]')).toBeNull();
    expect(fixture.nativeElement.textContent).toContain('Purge échoue');
  });

  it('ac08_1_6_12_a second favorite click is ignored while a toggle is already in flight', () => {
    httpMock.expectOne(r => r.url === BASE).flush(makePageResponse([makeBoard({ id: 'f5', favorite: false })]));
    fixture.detectChanges();

    const star = fixture.nativeElement.querySelector('.board-list__favorite-btn') as HTMLButtonElement;
    star.click();
    fixture.detectChanges();
    expect(star.disabled).toBe(true);

    // Disabled buttons don't dispatch click in real browsers, but the handler itself must also
    // guard re-entrancy defensively (e.g. programmatic dispatch, or a race with detectChanges).
    star.disabled = false;
    star.click();
    fixture.detectChanges();

    // Only one PUT request should ever have been made for this board.
    const req = httpMock.expectOne(r => r.url === `${BASE}/f5/favorite`);
    req.flush(null);
  });
});
