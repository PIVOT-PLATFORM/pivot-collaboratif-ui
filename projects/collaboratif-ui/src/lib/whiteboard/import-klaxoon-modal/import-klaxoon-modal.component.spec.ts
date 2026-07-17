import { ComponentFixture, TestBed } from '@angular/core/testing';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { TranslocoTestingModule } from '@jsverse/transloco';
import JSZip from 'jszip';
import { ImportKlaxoonModalComponent } from './import-klaxoon-modal.component';
import { COLLABORATIF_API_URL } from '../../core/whiteboard/config/tokens';
import type { KlxActivityEntry } from '../klx-import/archive';

const TEST_API_URL = 'http://localhost:8083/api/collaboratif';
const BOARD_ID = 'board-abc-123';
const IMPORT_URL = `${TEST_API_URL}/whiteboard/boards/${BOARD_ID}/import/klaxoon`;
const UNDO_URL = `${TEST_API_URL}/whiteboard/boards/${BOARD_ID}/import/undo`;

const FR: Record<string, unknown> = {
  whiteboard: {
    import: {
      trigger: 'Importer depuis Klaxoon',
      title: 'Importer depuis Klaxoon',
      close: 'Fermer',
      pickHint: 'Déposez votre export Klaxoon (.klx).',
      dropzone: 'Glissez le fichier .klx ici, ou cliquez pour le choisir',
      reading: 'Décompression et lecture des fichiers…',
      chooseHint: 'Cette archive contient plusieurs tableaux. Lequel importer ?',
      cancel: 'Annuler',
      previewTitle: "Aperçu de l'import",
      stats: {
        postits: 'Notes (post-its)',
        texts: 'Zones de texte',
        draws: 'Dessins',
        shapes: 'Formes',
        images: 'Images',
        zones: 'Cadres (zones)',
        links: 'Liaisons',
        groups: 'Groupes',
        fields: 'Champs',
        skipped: 'Ignorés',
      },
      confirm: 'Importer',
      importing: 'Import en cours…',
      doneMessage: '{{count}} élément(s) importé(s).',
      closeAction: 'Fermer',
      undo: "Annuler l'import",
      undoing: 'Annulation…',
      retry: 'Réessayer',
      error: {
        notKlx: "Ce fichier n'est pas une archive .klx.",
        noBrainstormData: 'Archive .klx invalide : _brainstorm_data.json introuvable.',
        corrupted: "Impossible de lire l'archive .klx.",
        importFailed: "Erreur lors de l'import.",
        undoFailed: "Impossible d'annuler l'import.",
      },
    },
  },
};

/** Protected/private surface exercised directly by this suite (same pattern as
 *  `structured-canvas.component.spec.ts` — bracket-notation bypasses the TS access
 *  modifier check without resorting to `any`). */
interface ImportKlaxoonApi {
  step(): string;
  activities(): KlxActivityEntry[];
  handleFile(file: File): Promise<void>;
  chooseActivity(activity: KlxActivityEntry): Promise<void>;
}

function makeIdea(uuid: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    uuid,
    is_active: true,
    color: { id: 'c1' },
    content_html: '<p>Hello</p>',
    coords: { left: 10, top: 10 },
    z_index: 0,
    is_locked: false,
    ...overrides,
  };
}

/** Builds a real in-memory `.klx` (zip) File containing one `_brainstorm_data.json` per
 *  `activities` entry (path -> raw Klaxoon JSON), round-tripped through JSZip exactly like a
 *  real export — no fixture binaries, no internal mocking of the archive/converter modules. */
async function buildKlxFile(
  activities: Record<string, unknown>,
  filename = 'export.klx',
): Promise<File> {
  const zip = new JSZip();
  for (const [path, data] of Object.entries(activities)) {
    zip.file(path, JSON.stringify(data));
  }
  const buffer = await zip.generateAsync({ type: 'arraybuffer' });
  return new File([buffer], filename, { type: 'application/zip' });
}

describe('ImportKlaxoonModalComponent', () => {
  let fixture: ComponentFixture<ImportKlaxoonModalComponent>;
  let api: ImportKlaxoonApi;
  let httpMock: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [
        ImportKlaxoonModalComponent,
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
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ImportKlaxoonModalComponent);
    fixture.componentRef.setInput('boardId', BOARD_ID);
    api = fixture.componentInstance as unknown as ImportKlaxoonApi;
    httpMock = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
  });

  afterEach(() => {
    httpMock.verify();
    TestBed.resetTestingModule();
  });

  // ── Pick step ──
  it('shows the dropzone on the initial pick step', () => {
    expect(fixture.nativeElement.querySelector('.klx-import__dropzone')).toBeTruthy();
    expect(api.step()).toBe('pick');
  });

  it('rejects a file whose name does not end in .klx', async () => {
    const file = new File(['not a zip'], 'notes.txt', { type: 'text/plain' });

    await api.handleFile(file);
    fixture.detectChanges();

    expect(api.step()).toBe('error');
    expect(fixture.nativeElement.querySelector('[role="alert"]').textContent).toContain(
      "n'est pas une archive .klx",
    );
  });

  it('shows a clear error when the archive has no _brainstorm_data.json', async () => {
    const zip = new JSZip();
    zip.file('metadata.json', '{}');
    const buffer = await zip.generateAsync({ type: 'arraybuffer' });
    const file = new File([buffer], 'export.klx');

    await api.handleFile(file);
    fixture.detectChanges();

    expect(api.step()).toBe('error');
    expect(fixture.nativeElement.querySelector('[role="alert"]').textContent).toContain(
      '_brainstorm_data.json introuvable',
    );
  });

  it('shows a clear error when the archive is not a valid zip', async () => {
    const file = new File(['this is not a zip at all'], 'export.klx');

    await api.handleFile(file);
    fixture.detectChanges();

    expect(api.step()).toBe('error');
    expect(fixture.nativeElement.querySelector('[role="alert"]')).toBeTruthy();
  });

  // ── Single activity → straight to preview ──
  it('converts a single-activity archive and shows the stats preview with zero HTTP call', async () => {
    const file = await buildKlxFile({
      '_brainstorm_data.json': {
        colors: [{ id: 'c1', hexa: '#FFEB3B' }],
        ideas: [makeIdea('idea-1')],
        state: [],
        links: [],
        groups: [],
      },
    });

    await api.handleFile(file);
    fixture.detectChanges();

    expect(api.step()).toBe('preview');
    const stats = fixture.nativeElement.querySelectorAll('.klx-import__stat');
    expect(stats.length).toBeGreaterThan(0);
    expect(fixture.nativeElement.textContent).toContain("Aperçu de l'import");
    // Cancelling the preview must not have produced any pending HTTP request (AC: aucune écriture
    // tant que l'utilisateur n'a pas validé).
    httpMock.verify();
  });

  // ── Multiple activities → chooser ──
  it('offers a chooser when the archive bundles several Klaxoon boards', async () => {
    const file = await buildKlxFile({
      'Activity/1/_brainstorm_data.json': { ideas: [makeIdea('a')], state: [], links: [], groups: [], colors: [] },
      'Activity/2/_brainstorm_data.json': { ideas: [makeIdea('b')], state: [], links: [], groups: [], colors: [] },
    });

    await api.handleFile(file);
    fixture.detectChanges();

    expect(api.step()).toBe('choose');
    expect(api.activities()).toHaveLength(2);

    await api.chooseActivity(api.activities()[0]);
    fixture.detectChanges();

    expect(api.step()).toBe('preview');
  });

  // ── Confirm → POST → memorize id lists → status announcement ──
  it('POSTs the converted content on confirm and announces the imported count via role=status', async () => {
    const file = await buildKlxFile({
      '_brainstorm_data.json': {
        colors: [{ id: 'c1', hexa: '#FFEB3B' }],
        ideas: [makeIdea('idea-1'), makeIdea('idea-2')],
        state: [],
        links: [],
        groups: [],
      },
    });
    await api.handleFile(file);
    fixture.detectChanges();

    const confirmBtn = fixture.nativeElement.querySelector('.klx-import__btn--primary') as HTMLButtonElement;
    confirmBtn.click();
    fixture.detectChanges();

    const req = httpMock.expectOne(r => r.url === IMPORT_URL && r.method === 'POST');
    const body = req.request.body as { cards: unknown[]; connections: unknown[] };
    expect(body.cards).toHaveLength(2);
    expect(body.connections).toEqual([]);

    req.flush({
      cards: 2, connections: 0, frames: 0,
      cardIds: ['srv-1', 'srv-2'], connectionIds: [], frameIds: [],
    });
    fixture.detectChanges();

    expect(api.step()).toBe('done');
    const status = fixture.nativeElement.querySelector('[role="status"]');
    expect(status).toBeTruthy();
    expect(status.textContent).toContain('2');
  });

  // ── Annuler l'import — replays undo with the exact memorized id lists ──
  it('memorizes the three id lists and "Annuler l\'import" replays undo with them', async () => {
    const file = await buildKlxFile({
      '_brainstorm_data.json': {
        colors: [{ id: 'c1', hexa: '#FFEB3B' }],
        ideas: [makeIdea('idea-1')],
        state: [],
        links: [],
        groups: [],
      },
    });
    await api.handleFile(file);
    fixture.detectChanges();

    (fixture.nativeElement.querySelector('.klx-import__btn--primary') as HTMLButtonElement).click();
    fixture.detectChanges();
    httpMock.expectOne(r => r.url === IMPORT_URL).flush({
      cards: 1, connections: 0, frames: 0,
      cardIds: ['srv-card-1'], connectionIds: ['srv-conn-1'], frameIds: ['srv-frame-1'],
    });
    fixture.detectChanges();

    let closed = false;
    fixture.componentInstance.closed.subscribe(() => { closed = true; });

    const undoBtn = fixture.nativeElement.querySelector('.klx-import__btn--danger') as HTMLButtonElement;
    expect(undoBtn.disabled).toBe(false);
    undoBtn.click();
    fixture.detectChanges();

    const undoReq = httpMock.expectOne(r => r.url === UNDO_URL && r.method === 'POST');
    expect(undoReq.request.body).toEqual({
      cardIds: ['srv-card-1'],
      connectionIds: ['srv-conn-1'],
      frameIds: ['srv-frame-1'],
    });
    undoReq.flush({ cards: 1, connections: 1, frames: 1 });
    fixture.detectChanges();

    expect(closed).toBe(true);
  });

  it('shows an error step when the undo call fails, without emitting closed', async () => {
    const file = await buildKlxFile({
      '_brainstorm_data.json': {
        colors: [], ideas: [makeIdea('idea-1')], state: [], links: [], groups: [],
      },
    });
    await api.handleFile(file);
    fixture.detectChanges();
    (fixture.nativeElement.querySelector('.klx-import__btn--primary') as HTMLButtonElement).click();
    fixture.detectChanges();
    httpMock.expectOne(r => r.url === IMPORT_URL).flush({
      cards: 1, connections: 0, frames: 0, cardIds: ['c1'], connectionIds: [], frameIds: [],
    });
    fixture.detectChanges();

    let closed = false;
    fixture.componentInstance.closed.subscribe(() => { closed = true; });

    (fixture.nativeElement.querySelector('.klx-import__btn--danger') as HTMLButtonElement).click();
    fixture.detectChanges();
    httpMock.expectOne(r => r.url === UNDO_URL).flush('', { status: 500, statusText: 'Error' });
    fixture.detectChanges();

    expect(api.step()).toBe('error');
    expect(closed).toBe(false);
  });

  // ── Close / Escape ──
  it('close button emits closed', () => {
    let closed = false;
    fixture.componentInstance.closed.subscribe(() => { closed = true; });

    (fixture.nativeElement.querySelector('.klx-import__close-btn') as HTMLButtonElement).click();

    expect(closed).toBe(true);
  });

  it('Escape key emits closed', () => {
    let closed = false;
    fixture.componentInstance.closed.subscribe(() => { closed = true; });

    const host = fixture.nativeElement.querySelector('.klx-import') as HTMLElement;
    host.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    expect(closed).toBe(true);
  });

  // ── Real DOM file input / drag-drop wiring ──
  it('clicking the dropzone opens the hidden file input', () => {
    const input = fixture.nativeElement.querySelector('.klx-import__file-input') as HTMLInputElement;
    const clickSpy = vi.spyOn(input, 'click');

    (fixture.nativeElement.querySelector('.klx-import__dropzone') as HTMLElement).click();

    expect(clickSpy).toHaveBeenCalledTimes(1);
  });

  it('selecting a file via the hidden input converts it and shows the preview', async () => {
    const file = await buildKlxFile({
      '_brainstorm_data.json': { colors: [], ideas: [makeIdea('idea-1')], state: [], links: [], groups: [] },
    });
    const input = fixture.nativeElement.querySelector('.klx-import__file-input') as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: [file], configurable: true });

    // onFileInputChange fires the private, fire-and-forget handleFile() — poll for its outcome
    // instead of racing its internal (unawaited) promise chain.
    input.dispatchEvent(new Event('change'));
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(api.step()).toBe('preview');
    });

    // The hidden input is reset so the same file can be re-selected consecutively.
    expect(input.value).toBe('');
  });

  it('drag-over/drag-leave toggle the dropzone active state, and drop converts the file', async () => {
    const dropzone = fixture.nativeElement.querySelector('.klx-import__dropzone') as HTMLElement;
    const dragOverEvent = new Event('dragover', { cancelable: true }) as DragEvent;
    dropzone.dispatchEvent(dragOverEvent);
    fixture.detectChanges();
    expect(dropzone.classList.contains('klx-import__dropzone--active')).toBe(true);

    const dragLeaveEvent = new Event('dragleave') as DragEvent;
    dropzone.dispatchEvent(dragLeaveEvent);
    fixture.detectChanges();
    expect(dropzone.classList.contains('klx-import__dropzone--active')).toBe(false);

    const file = await buildKlxFile({
      '_brainstorm_data.json': { colors: [], ideas: [makeIdea('idea-1')], state: [], links: [], groups: [] },
    });
    const dropEvent = new Event('drop', { cancelable: true }) as DragEvent;
    Object.defineProperty(dropEvent, 'dataTransfer', { value: { files: [file] } });
    dropzone.dispatchEvent(dropEvent);

    // Same reasoning as the input-change test: onDrop() dispatches the fire-and-forget
    // handleFile() — poll for its outcome instead of racing it.
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(api.step()).toBe('preview');
    });
  });

  // ── Retry from the error step ──
  it('"Réessayer" returns to the pick step and clears the error', async () => {
    await api.handleFile(new File(['nope'], 'notes.txt'));
    fixture.detectChanges();
    expect(api.step()).toBe('error');

    (fixture.nativeElement.querySelector('.klx-import__btn--primary') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(api.step()).toBe('pick');
    expect(fixture.nativeElement.querySelector('[role="alert"]')).toBeNull();
  });

  // ── Undo double-click guard ──
  it('a second "Annuler l\'import" click while the first is in flight sends only one request', async () => {
    const file = await buildKlxFile({
      '_brainstorm_data.json': { colors: [], ideas: [makeIdea('idea-1')], state: [], links: [], groups: [] },
    });
    await api.handleFile(file);
    fixture.detectChanges();
    (fixture.nativeElement.querySelector('.klx-import__btn--primary') as HTMLButtonElement).click();
    fixture.detectChanges();
    httpMock.expectOne(r => r.url === IMPORT_URL).flush({
      cards: 1, connections: 0, frames: 0, cardIds: ['c1'], connectionIds: [], frameIds: [],
    });
    fixture.detectChanges();

    const undoBtn = fixture.nativeElement.querySelector('.klx-import__btn--danger') as HTMLButtonElement;
    // Two synchronous clicks before change detection re-renders `[disabled]` — exercises the
    // component-level in-flight guard, not just the DOM `disabled` attribute.
    undoBtn.click();
    undoBtn.click();

    httpMock.expectOne(r => r.url === UNDO_URL).flush({ cards: 1, connections: 0, frames: 0 });
    fixture.detectChanges();
  });
});
