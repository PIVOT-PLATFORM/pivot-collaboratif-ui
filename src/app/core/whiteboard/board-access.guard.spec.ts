import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import {
  ActivatedRouteSnapshot,
  RouterStateSnapshot,
  Router,
  UrlTree,
  convertToParamMap,
  provideRouter,
} from '@angular/router';
import { TranslocoService } from '@jsverse/transloco';
import { firstValueFrom, Observable } from 'rxjs';
import { boardAccessGuard } from './board-access.guard';
import { ToastService } from '../toast/toast.service';
import { environment } from '../../../environments/environment';

const API_URL = `${environment.apiUrl}/whiteboard/boards`;

function makeRoute(boardId: string): ActivatedRouteSnapshot {
  return {
    paramMap: convertToParamMap({ boardId }),
  } as unknown as ActivatedRouteSnapshot;
}

describe('boardAccessGuard', () => {
  let httpMock: HttpTestingController;
  let router: Router;
  let toastService: ToastService;

  const mockTransloco = { translate: (key: string) => key };

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: TranslocoService, useValue: mockTransloco },
      ],
    });
    httpMock = TestBed.inject(HttpTestingController);
    router = TestBed.inject(Router);
    toastService = TestBed.inject(ToastService);
  });

  afterEach(() => httpMock.verify());

  it('should return true when API responds 200 (access granted)', async () => {
    const guard$ = TestBed.runInInjectionContext(() =>
      boardAccessGuard(makeRoute('board-abc'), {} as RouterStateSnapshot),
    ) as Observable<boolean | UrlTree>;

    const resultPromise = firstValueFrom(guard$);
    httpMock.expectOne(`${API_URL}/board-abc`).flush({});

    expect(await resultPromise).toBe(true);
  });

  it('should redirect to /whiteboard and show toast when API returns 403 (non-member)', async () => {
    const toastSpy = vi.spyOn(toastService, 'show');
    const guard$ = TestBed.runInInjectionContext(() =>
      boardAccessGuard(makeRoute('board-abc'), {} as RouterStateSnapshot),
    ) as Observable<boolean | UrlTree>;

    const resultPromise = firstValueFrom(guard$);
    httpMock
      .expectOne(`${API_URL}/board-abc`)
      .flush({}, { status: 403, statusText: 'Forbidden' });

    const result = await resultPromise;
    expect(result).toBeInstanceOf(UrlTree);
    expect(router.serializeUrl(result as UrlTree)).toBe('/whiteboard');
    expect(toastSpy).toHaveBeenCalledWith('whiteboard.guard.accessDenied', 'error');
  });

  it('should redirect to /whiteboard and show toast when API returns 404 (cross-tenant or not found)', async () => {
    const toastSpy = vi.spyOn(toastService, 'show');
    const guard$ = TestBed.runInInjectionContext(() =>
      boardAccessGuard(makeRoute('board-xyz'), {} as RouterStateSnapshot),
    ) as Observable<boolean | UrlTree>;

    const resultPromise = firstValueFrom(guard$);
    httpMock
      .expectOne(`${API_URL}/board-xyz`)
      .flush({}, { status: 404, statusText: 'Not Found' });

    const result = await resultPromise;
    expect(result).toBeInstanceOf(UrlTree);
    expect(router.serializeUrl(result as UrlTree)).toBe('/whiteboard');
    expect(toastSpy).toHaveBeenCalledWith('whiteboard.guard.accessDenied', 'error');
  });

  it('should fail-closed when boardId is absent from route params (defensive)', async () => {
    const toastSpy = vi.spyOn(toastService, 'show');
    const routeWithoutBoardId = {
      paramMap: convertToParamMap({}),
    } as unknown as ActivatedRouteSnapshot;

    const guard$ = TestBed.runInInjectionContext(() =>
      boardAccessGuard(routeWithoutBoardId, {} as RouterStateSnapshot),
    ) as Observable<boolean | UrlTree>;

    const result = await firstValueFrom(guard$);
    expect(result).toBeInstanceOf(UrlTree);
    expect(router.serializeUrl(result as UrlTree)).toBe('/whiteboard');
    expect(toastSpy).toHaveBeenCalledWith('whiteboard.guard.accessDenied', 'error');
    httpMock.expectNone(`${API_URL}/`);
  });

  it('should fail-closed (redirect /whiteboard) on network error', async () => {
    const toastSpy = vi.spyOn(toastService, 'show');
    const guard$ = TestBed.runInInjectionContext(() =>
      boardAccessGuard(makeRoute('board-abc'), {} as RouterStateSnapshot),
    ) as Observable<boolean | UrlTree>;

    const resultPromise = firstValueFrom(guard$);
    httpMock
      .expectOne(`${API_URL}/board-abc`)
      .error(new ProgressEvent('error'));

    const result = await resultPromise;
    expect(result).toBeInstanceOf(UrlTree);
    expect(router.serializeUrl(result as UrlTree)).toBe('/whiteboard');
    expect(toastSpy).toHaveBeenCalledWith('whiteboard.guard.accessDenied', 'error');
  });
});
