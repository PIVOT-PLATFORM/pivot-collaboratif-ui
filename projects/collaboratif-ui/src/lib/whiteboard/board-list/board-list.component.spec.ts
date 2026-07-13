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
});
