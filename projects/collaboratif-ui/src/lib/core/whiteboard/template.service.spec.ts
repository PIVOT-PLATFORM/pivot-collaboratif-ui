import { TestBed } from '@angular/core/testing';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { TemplateService } from './template.service';
import { WhiteboardTemplate } from './board.model';
import { COLLABORATIF_API_URL } from './config/tokens';

const TEST_API_URL = 'http://localhost:8083/api/collaboratif';
const BASE = `${TEST_API_URL}/whiteboard/templates`;

describe('TemplateService', () => {
  let service: TemplateService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: COLLABORATIF_API_URL, useValue: TEST_API_URL },
      ],
    });
    service = TestBed.inject(TemplateService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('getTemplates() sends GET to /whiteboard/templates', () => {
    const templates: WhiteboardTemplate[] = [
      { id: 't-1', code: 'BRAINSTORM', thumbnailUrl: 'https://cdn.example.com/brainstorm.png' },
      { id: 't-2', code: 'RETROSPECTIVE', thumbnailUrl: 'https://cdn.example.com/retro.png' },
      { id: 't-3', code: 'USER_STORY_MAP', thumbnailUrl: 'https://cdn.example.com/usm.png' },
    ];

    let result: WhiteboardTemplate[] | undefined;
    service.getTemplates().subscribe(r => { result = r; });

    const req = httpMock.expectOne(BASE);
    expect(req.request.method).toBe('GET');
    req.flush(templates);
    expect(result).toEqual(templates);
  });

  it('getTemplates() propagates HTTP errors', () => {
    let caught = false;
    service.getTemplates().subscribe({ error: () => { caught = true; } });
    httpMock.expectOne(BASE).flush('', { status: 500, statusText: 'Server Error' });
    expect(caught).toBe(true);
  });
});
