import { TestBed } from '@angular/core/testing';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { BoardService } from './board.service';
import { environment } from '../../../environments/environment';

const BASE = `${environment.apiUrl}/whiteboard/boards`;

describe('BoardService', () => {
  let service: BoardService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(BoardService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('getBoards() requests page 0 with size 20', () => {
    service.getBoards().subscribe();
    const req = httpMock.expectOne(
      r => r.url === BASE && r.params.get('page') === '0' && r.params.get('size') === '20',
    );
    expect(req.request.method).toBe('GET');
    req.flush({ boards: [], totalElements: 0, totalPages: 0, currentPage: 0, hasNext: false });
  });

  it('getBoards(2) requests page 2', () => {
    service.getBoards(2).subscribe();
    const req = httpMock.expectOne(
      r => r.url === BASE && r.params.get('page') === '2',
    );
    expect(req.request.method).toBe('GET');
    req.flush({ boards: [], totalElements: 0, totalPages: 0, currentPage: 2, hasNext: false });
  });

  it('getBoards() propagates HTTP errors', () => {
    let caught = false;
    service.getBoards().subscribe({ error: () => { caught = true; } });
    httpMock.expectOne(r => r.url === BASE).flush('', { status: 500, statusText: 'Server Error' });
    expect(caught).toBe(true);
  });

  it('createBoard() sends POST with title in body', () => {
    service.createBoard('Mon tableau').subscribe();
    const req = httpMock.expectOne(r => r.url === BASE && r.method === 'POST');
    expect(req.request.body).toEqual({ title: 'Mon tableau' });
    req.flush({ id: 'abc', title: 'Mon tableau', role: 'owner', createdAt: '', updatedAt: '', thumbnailUrl: null, activeParticipantCount: 0 });
  });

  it('createBoard() propagates HTTP errors', () => {
    let caught = false;
    service.createBoard('test').subscribe({ error: () => { caught = true; } });
    httpMock.expectOne(r => r.url === BASE && r.method === 'POST').flush('', { status: 400, statusText: 'Bad Request' });
    expect(caught).toBe(true);
  });
});
