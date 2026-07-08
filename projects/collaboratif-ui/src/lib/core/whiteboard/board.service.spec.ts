import { TestBed } from '@angular/core/testing';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { BoardService } from './board.service';
import { BoardMember, ShareToken } from './board.model';
import { COLLABORATIF_API_URL } from './config/tokens';

const TEST_API_URL = 'http://localhost:8083/api/collaboratif';
const BASE = `${TEST_API_URL}/whiteboard/boards`;

describe('BoardService', () => {
  let service: BoardService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: COLLABORATIF_API_URL, useValue: TEST_API_URL },
      ],
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

  it('createBoard() sends templateId as query param when provided', () => {
    service.createBoard('Depuis template', 'template-uuid-1').subscribe();
    const req = httpMock.expectOne(
      r => r.url === BASE && r.method === 'POST' && r.params.get('templateId') === 'template-uuid-1',
    );
    expect(req.request.body).toEqual({ title: 'Depuis template' });
    req.flush({ id: 'abc', title: 'Depuis template', role: 'owner', createdAt: '', updatedAt: '', thumbnailUrl: null, activeParticipantCount: 0 });
  });

  it('createBoard() omits templateId query param when not provided', () => {
    service.createBoard('Vierge').subscribe();
    const req = httpMock.expectOne(r => r.url === BASE && r.method === 'POST');
    expect(req.request.params.has('templateId')).toBe(false);
    req.flush({ id: 'abc', title: 'Vierge', role: 'owner', createdAt: '', updatedAt: '', thumbnailUrl: null, activeParticipantCount: 0 });
  });

  it('createBoard() with invalid templateId propagates 400 INVALID_TEMPLATE_ID', () => {
    let caught: number | undefined;
    service.createBoard('x', 'not-a-uuid').subscribe({ error: (err) => { caught = err.status; } });
    httpMock.expectOne(r => r.url === BASE && r.params.get('templateId') === 'not-a-uuid')
      .flush({ code: 'INVALID_TEMPLATE_ID' }, { status: 400, statusText: 'Bad Request' });
    expect(caught).toBe(400);
  });

  it('createBoard() with unknown templateId propagates 404', () => {
    let caught: number | undefined;
    service.createBoard('x', 'unknown-template-id').subscribe({ error: (err) => { caught = err.status; } });
    httpMock.expectOne(r => r.url === BASE && r.params.get('templateId') === 'unknown-template-id')
      .flush('', { status: 404, statusText: 'Not Found' });
    expect(caught).toBe(404);
  });

  it('createBoard() propagates HTTP errors', () => {
    let caught = false;
    service.createBoard('test').subscribe({ error: () => { caught = true; } });
    httpMock.expectOne(r => r.url === BASE && r.method === 'POST').flush('', { status: 400, statusText: 'Bad Request' });
    expect(caught).toBe(true);
  });

  it('renameBoard() sends PATCH with new title', () => {
    const boardId = 'board-uuid-1';
    service.renameBoard(boardId, 'Nouveau nom').subscribe();
    const req = httpMock.expectOne(r => r.url === `${BASE}/${boardId}` && r.method === 'PATCH');
    expect(req.request.body).toEqual({ title: 'Nouveau nom' });
    req.flush({ id: boardId, title: 'Nouveau nom', role: 'owner', createdAt: '', updatedAt: '', thumbnailUrl: null, activeParticipantCount: 0 });
  });

  it('renameBoard() propagates HTTP errors', () => {
    let caught = false;
    service.renameBoard('bid', 'x').subscribe({ error: () => { caught = true; } });
    httpMock.expectOne(r => r.url === `${BASE}/bid` && r.method === 'PATCH').flush('', { status: 403, statusText: 'Forbidden' });
    expect(caught).toBe(true);
  });

  it('deleteBoard() sends DELETE to boards/{boardId}', () => {
    const boardId = 'board-to-delete';
    service.deleteBoard(boardId).subscribe();
    const req = httpMock.expectOne(r => r.url === `${BASE}/${boardId}` && r.method === 'DELETE');
    expect(req.request.body).toBeNull();
    req.flush(null);
  });

  it('deleteBoard() propagates HTTP errors', () => {
    let caught = false;
    service.deleteBoard('bid').subscribe({ error: () => { caught = true; } });
    httpMock.expectOne(r => r.url === `${BASE}/bid` && r.method === 'DELETE').flush('', { status: 403, statusText: 'Forbidden' });
    expect(caught).toBe(true);
  });

  // ── listMembers ──
  it('listMembers() sends GET to /boards/{boardId}/members', () => {
    const boardId = 'board-m1';
    const members: BoardMember[] = [
      { userId: 'user-1', role: 'OWNER', joinedAt: '2026-07-01T00:00:00Z' },
      { userId: 'user-2', role: 'EDITOR', joinedAt: '2026-07-02T00:00:00Z' },
    ];

    let result: BoardMember[] | undefined;
    service.listMembers(boardId).subscribe(r => { result = r; });

    const req = httpMock.expectOne(`${BASE}/${boardId}/members`);
    expect(req.request.method).toBe('GET');
    req.flush(members);
    expect(result).toEqual(members);
  });

  it('listMembers() propagates HTTP errors', () => {
    let caught = false;
    service.listMembers('bid').subscribe({ error: () => { caught = true; } });
    httpMock.expectOne(`${BASE}/bid/members`).flush('', { status: 404, statusText: 'Not Found' });
    expect(caught).toBe(true);
  });

  // ── generateShareToken ──
  it('generateShareToken() sends POST with role in body', () => {
    const boardId = 'board-s1';
    const response: ShareToken = { id: 'tok-1', token: 'secret', role: 'EDITOR', maxUses: 5, expiresAt: '2026-08-01T00:00:00Z' };

    let result: ShareToken | undefined;
    service.generateShareToken(boardId, 'EDITOR').subscribe(r => { result = r; });

    const req = httpMock.expectOne(`${BASE}/${boardId}/share`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ role: 'EDITOR' });
    req.flush(response);
    expect(result).toEqual(response);
  });

  it('generateShareToken() propagates HTTP errors', () => {
    let caught = false;
    service.generateShareToken('bid', 'VIEWER').subscribe({ error: () => { caught = true; } });
    httpMock.expectOne(`${BASE}/bid/share`).flush('', { status: 403, statusText: 'Forbidden' });
    expect(caught).toBe(true);
  });

  // ── revokeShareToken ──
  it('revokeShareToken() sends DELETE to /boards/{boardId}/share/{tokenId}', () => {
    const boardId = 'board-r1';
    const tokenId = 'tok-xyz';
    let completed = false;

    service.revokeShareToken(boardId, tokenId).subscribe({ complete: () => { completed = true; } });

    const req = httpMock.expectOne(`${BASE}/${boardId}/share/${tokenId}`);
    expect(req.request.method).toBe('DELETE');
    req.flush(null);
    expect(completed).toBe(true);
  });

  it('revokeShareToken() propagates HTTP errors', () => {
    let caught = false;
    service.revokeShareToken('bid', 'tid').subscribe({ error: () => { caught = true; } });
    httpMock.expectOne(`${BASE}/bid/share/tid`).flush('', { status: 404, statusText: 'Not Found' });
    expect(caught).toBe(true);
  });

  // ── joinBoard ──
  it('joinBoard() sends POST to /whiteboard/join with token as query param', () => {
    const JOIN_URL = `${TEST_API_URL}/whiteboard/join`;
    const response = { boardId: 'b1', title: 'Board', role: 'EDITOR', redirectUrl: '/whiteboard/b1' };

    let result: unknown;
    service.joinBoard('my-token').subscribe(r => { result = r; });

    const req = httpMock.expectOne(r => r.url === JOIN_URL && r.params.get('token') === 'my-token');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toBeNull();
    req.flush(response);
    expect(result).toEqual(response);
  });

  it('joinBoard() propagates HTTP errors', () => {
    const JOIN_URL = `${TEST_API_URL}/whiteboard/join`;
    let caught = false;
    service.joinBoard('bad-token').subscribe({ error: () => { caught = true; } });
    httpMock.expectOne(r => r.url === JOIN_URL).flush('', { status: 410, statusText: 'Gone' });
    expect(caught).toBe(true);
  });

  // ── updateMemberRole ──
  it('updateMemberRole() sends PATCH with role in body', () => {
    const boardId = 'board-u1';
    const userId = 'user-u1';
    const updated: BoardMember = { userId, role: 'VIEWER', joinedAt: '2026-07-01T00:00:00Z' };

    let result: BoardMember | undefined;
    service.updateMemberRole(boardId, userId, 'VIEWER').subscribe(r => { result = r; });

    const req = httpMock.expectOne(`${BASE}/${boardId}/members/${userId}/role`);
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({ role: 'VIEWER' });
    req.flush(updated);
    expect(result).toEqual(updated);
  });

  it('updateMemberRole() propagates HTTP errors', () => {
    let caught = false;
    service.updateMemberRole('bid', 'uid', 'EDITOR').subscribe({ error: () => { caught = true; } });
    httpMock.expectOne(`${BASE}/bid/members/uid/role`).flush('', { status: 400, statusText: 'Bad Request' });
    expect(caught).toBe(true);
  });

  // ── removeMember ──
  it('removeMember() sends DELETE to /boards/{boardId}/members/{userId}', () => {
    const boardId = 'board-rm1';
    const userId = 'user-rm1';
    let completed = false;

    service.removeMember(boardId, userId).subscribe({ complete: () => { completed = true; } });

    const req = httpMock.expectOne(`${BASE}/${boardId}/members/${userId}`);
    expect(req.request.method).toBe('DELETE');
    req.flush(null);
    expect(completed).toBe(true);
  });

  it('removeMember() propagates HTTP errors', () => {
    let caught = false;
    service.removeMember('bid', 'uid').subscribe({ error: () => { caught = true; } });
    httpMock.expectOne(`${BASE}/bid/members/uid`).flush('', { status: 403, statusText: 'Forbidden' });
    expect(caught).toBe(true);
  });
});
