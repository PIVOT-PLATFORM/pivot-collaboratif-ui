import { ComponentFixture, TestBed } from '@angular/core/testing';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { of } from 'rxjs';
import { TranslocoTestingModule } from '@jsverse/transloco';
import { JoinBoardComponent } from './join-board.component';
import { COLLABORATIF_API_URL } from '../../core/whiteboard/config/tokens';

const TEST_API_URL = 'http://localhost:8083/api/collaboratif';
const JOIN_URL = `${TEST_API_URL}/whiteboard/join`;

const FR: Record<string, unknown> = {
  whiteboard: {
    join: {
      loading: 'Rejoindre le tableau…',
      error401: 'Vous devez être connecté.',
      error403: 'Vous n\'avez pas les droits.',
      error404: 'Lien invalide ou introuvable.',
      error409: 'Vous êtes déjà membre.',
      error410: 'Lien expiré ou révoqué.',
      error429: 'Trop de tentatives.',
      errorDefault: 'Erreur, réessayez.',
      retry: 'Réessayer',
    },
  },
};

const SUCCESS_BODY = {
  boardId: 'board-42',
  title: 'Test Board',
  role: 'EDITOR',
  redirectUrl: '/whiteboard/board-42',
};

describe('JoinBoardComponent — with token', () => {
  let fixture: ComponentFixture<JoinBoardComponent>;
  let httpMock: HttpTestingController;
  let router: Router;
  let navSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [
        JoinBoardComponent,
        TranslocoTestingModule.forRoot({
          langs: { fr: FR },
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
          useValue: { queryParamMap: of(convertToParamMap({ token: 'valid-token' })) },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(JoinBoardComponent);
    httpMock = TestBed.inject(HttpTestingController);
    router = TestBed.inject(Router);
    navSpy = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
  });

  afterEach(() => {
    navSpy.mockRestore();
    httpMock.verify();
    TestBed.resetTestingModule();
  });

  // ── Loading state ──
  it('shows loading spinner while join request is pending', () => {
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('[aria-busy="true"]')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('.join-board__spinner')).toBeTruthy();

    // flush to avoid httpMock.verify() error
    httpMock.expectOne(r => r.url === JOIN_URL).flush(SUCCESS_BODY);
    fixture.detectChanges();
  });

  // ── Success: navigate to redirectUrl ──
  it('navigates to redirectUrl on successful join', () => {
    fixture.detectChanges();

    httpMock.expectOne(r => r.url === JOIN_URL).flush(SUCCESS_BODY);
    fixture.detectChanges();

    expect(navSpy).toHaveBeenCalledWith('/whiteboard/board-42');
  });

  // ── Token passed as query param ──
  it('sends token as query param in the POST request', () => {
    fixture.detectChanges();

    const req = httpMock.expectOne(r => r.url === JOIN_URL);
    expect(req.request.params.get('token')).toBe('valid-token');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toBeNull();
    req.flush(SUCCESS_BODY);
    fixture.detectChanges();
  });

  // ── Error 404 ──
  it('shows 404 error message on invalid token', () => {
    fixture.detectChanges();
    httpMock.expectOne(r => r.url === JOIN_URL).flush('', { status: 404, statusText: 'Not Found' });
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('[role="alert"]')).toBeTruthy();
    expect(fixture.nativeElement.textContent).toContain('Lien invalide ou introuvable.');
  });

  // ── Error 410 ──
  it('shows 410 error message on expired token', () => {
    fixture.detectChanges();
    httpMock.expectOne(r => r.url === JOIN_URL).flush('', { status: 410, statusText: 'Gone' });
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Lien expiré ou révoqué.');
  });

  // ── Error 401 ──
  it('shows 401 error message on unauthenticated request', () => {
    fixture.detectChanges();
    httpMock.expectOne(r => r.url === JOIN_URL).flush('', { status: 401, statusText: 'Unauthorized' });
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Vous devez être connecté.');
  });

  // ── Error 409 ──
  it('shows 409 error when user is already a member', () => {
    fixture.detectChanges();
    httpMock.expectOne(r => r.url === JOIN_URL).flush('', { status: 409, statusText: 'Conflict' });
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Vous êtes déjà membre.');
  });

  // ── Unknown error → default message ──
  it('shows default error message for unexpected status codes', () => {
    fixture.detectChanges();
    httpMock.expectOne(r => r.url === JOIN_URL).flush('', { status: 502, statusText: 'Bad Gateway' });
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Erreur, réessayez.');
  });

  // ── Retry button ──
  it('retry button triggers a new join request', () => {
    fixture.detectChanges();
    httpMock.expectOne(r => r.url === JOIN_URL).flush('', { status: 404, statusText: 'Not Found' });
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.join-board__retry-btn')).toBeTruthy();
    fixture.nativeElement.querySelector('.join-board__retry-btn').click();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('[aria-busy="true"]')).toBeTruthy();

    httpMock.expectOne(r => r.url === JOIN_URL).flush(SUCCESS_BODY);
    fixture.detectChanges();

    expect(navSpy).toHaveBeenCalledWith('/whiteboard/board-42');
  });
});

describe('JoinBoardComponent — no token', () => {
  let fixture: ComponentFixture<JoinBoardComponent>;
  let httpMock: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [
        JoinBoardComponent,
        TranslocoTestingModule.forRoot({
          langs: { fr: FR },
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
          useValue: { queryParamMap: of(convertToParamMap({})) },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(JoinBoardComponent);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
    TestBed.resetTestingModule();
  });

  it('shows error immediately when no token is present in URL', () => {
    fixture.detectChanges();
    httpMock.expectNone(JOIN_URL);
    expect(fixture.nativeElement.querySelector('[role="alert"]')).toBeTruthy();
  });
});
