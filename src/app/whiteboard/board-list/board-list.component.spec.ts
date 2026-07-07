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
import { Board, BoardPage } from '../../core/whiteboard/board.model';
import { environment } from '../../../environments/environment';

const BASE = `${environment.apiUrl}/whiteboard/boards`;

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

    (fixture.nativeElement.querySelector('.board-list__create-btn') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('[role="dialog"]')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('#board-title-input')).toBeTruthy();
  });

  it('closes modal when cancel button clicked', () => {
    httpMock.expectOne(r => r.url === BASE).flush(makePageResponse([]));
    fixture.detectChanges();

    (fixture.nativeElement.querySelector('.board-list__create-btn') as HTMLButtonElement).click();
    fixture.detectChanges();

    (fixture.nativeElement.querySelector('.board-list__modal-btn--cancel') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[role="dialog"]')).toBeNull();
  });

  it('submits create board and navigates on success', async () => {
    httpMock.expectOne(r => r.url === BASE).flush(makePageResponse([]));
    fixture.detectChanges();

    (fixture.nativeElement.querySelector('.board-list__create-btn') as HTMLButtonElement).click();
    fixture.detectChanges();

    const input = fixture.nativeElement.querySelector('#board-title-input') as HTMLInputElement;
    input.value = 'Nouveau test';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    const spy = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    (fixture.nativeElement.querySelector('.board-list__modal-btn--confirm') as HTMLButtonElement).click();
    fixture.detectChanges();

    const createReq = httpMock.expectOne(r => r.url === BASE && r.method === 'POST');
    expect(createReq.request.body).toEqual({ title: 'Nouveau test' });
    createReq.flush(makeBoard({ id: 'new-id', title: 'Nouveau test' }));
    fixture.detectChanges();

    expect(spy).toHaveBeenCalledWith(['/whiteboard', 'new-id']);
    spy.mockRestore();
  });

  it('shows toast on create board failure', () => {
    httpMock.expectOne(r => r.url === BASE).flush(makePageResponse([]));
    fixture.detectChanges();

    const toastSpy = vi.spyOn(toastService, 'show');
    (fixture.nativeElement.querySelector('.board-list__create-btn') as HTMLButtonElement).click();
    fixture.detectChanges();

    const input = fixture.nativeElement.querySelector('#board-title-input') as HTMLInputElement;
    input.value = 'Fail board';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    (fixture.nativeElement.querySelector('.board-list__modal-btn--confirm') as HTMLButtonElement).click();
    fixture.detectChanges();

    httpMock.expectOne(r => r.url === BASE && r.method === 'POST')
      .flush('', { status: 500, statusText: 'Error' });
    fixture.detectChanges();

    expect(toastSpy).toHaveBeenCalledWith('Impossible de créer le tableau', 'error');
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

  // ── Menu stubs ──
  it('rename and delete menu items are clickable stubs', () => {
    httpMock.expectOne(r => r.url === BASE).flush(makePageResponse([makeBoard({ id: 'y' })]));
    fixture.detectChanges();

    (fixture.nativeElement.querySelector('.board-list__card-menu-btn') as HTMLButtonElement).click();
    fixture.detectChanges();

    const menuItems = fixture.nativeElement.querySelectorAll('.board-list__menu-item') as NodeListOf<HTMLButtonElement>;
    expect(menuItems.length).toBe(2);
    expect(() => {
      menuItems[0].click(); // rename stub
      menuItems[1].click(); // delete stub
    }).not.toThrow();
  });

  // ── Empty state CTA ──
  it('empty state CTA opens create modal', () => {
    httpMock.expectOne(r => r.url === BASE).flush(makePageResponse([]));
    fixture.detectChanges();

    const cta = fixture.nativeElement.querySelector('.board-list__empty-cta') as HTMLButtonElement;
    cta.click();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('[role="dialog"]')).toBeTruthy();
    httpMock.expectNone(r => r.url === BASE); // no additional HTTP call on modal open
  });
});
