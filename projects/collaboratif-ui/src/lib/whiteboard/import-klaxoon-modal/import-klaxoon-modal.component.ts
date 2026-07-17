import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  HostListener,
  computed,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import JSZip from 'jszip';
import { TranslocoPipe } from '@jsverse/transloco';
import { BoardService } from '../../core/whiteboard/board.service';
import type { KlaxoonImportResponse } from '../../core/whiteboard/board.model';
import {
  convertKlaxoon,
  type KlxCard,
  type KlxConnection,
  type KlxField,
  type KlxFrame,
  type KlxImportStats,
  type KlxRawData,
} from '../klx-import/converter';
import { findKlxActivities, mediaKey, mimeForPath, type KlxActivityEntry } from '../klx-import/archive';

/** Step machine for the import flow — mirrors the PouetPouet reference modal (`import-klaxoon-modal.tsx`). */
type Step = 'pick' | 'reading' | 'choose' | 'preview' | 'importing' | 'done' | 'error';

/**
 * The loaded-archive handle type. `jszip`'s own typings expose `JSZip` both as a value (the
 * `export =` binding) and as an interface, but that interface's `file()` method returns a
 * polymorphic `this` — assigning `Promise<JSZip>`'s resolved value to a plain `JSZip`-typed
 * field trips a structural `this`-type variance error. Deriving the type from `loadAsync`'s own
 * return signature sidesteps it without any cast.
 */
type LoadedKlxArchive = Awaited<ReturnType<typeof JSZip.loadAsync>>;

/** Result of a successful conversion, pending confirmation (no server call has happened yet). */
interface PendingImport {
  cards: KlxCard[];
  connections: KlxConnection[];
  frames: KlxFrame[];
  fields: KlxField[];
}

/**
 * Import a Klaxoon `.klx` archive into the current board (US08.13.1).
 *
 * Flow: pick the file (or drag it in) → decompress + locate its Klaxoon "Activity" board(s)
 * client-side (`klx-import/archive.ts`) → if several, let the user choose one → run the pure
 * conversion (`klx-import/converter.ts`) → show a stats preview with **zero server side-effect**
 * → on confirm, POST the converted content and memorize the three returned id lists → offer a
 * one-click "Annuler l'import" that replays those exact ids against `/import/undo`.
 *
 * Rendering of the imported content itself is not this component's job: the backend broadcasts
 * `board:imported` over STOMP once persisted, and `BoardStore` already merges it into the board
 * signals (see `board.store.ts`) — this component only owns the trigger→POST→undo wiring.
 */
@Component({
  selector: 'wb-import-klaxoon-modal',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslocoPipe],
  templateUrl: './import-klaxoon-modal.component.html',
  styleUrl: './import-klaxoon-modal.component.scss',
})
export class ImportKlaxoonModalComponent {
  /** Board the archive is imported into. */
  readonly boardId = input.required<string>();
  /** Emitted when the user dismisses the modal (close button, Escape, or cancel at any step). */
  readonly closed = output<void>();

  private readonly boardService = inject(BoardService);
  private readonly fileInput = viewChild<ElementRef<HTMLInputElement>>('fileInput');

  protected readonly step = signal<Step>('pick');
  protected readonly dragging = signal(false);
  protected readonly activities = signal<KlxActivityEntry[]>([]);
  protected readonly stats = signal<KlxImportStats | null>(null);
  protected readonly result = signal<KlaxoonImportResponse | null>(null);
  protected readonly undoing = signal(false);
  protected readonly errorKey = signal<string>('');

  /** Total imported elements announced to `role="status"` once the import completes (AC A11y). */
  protected readonly importedCount = computed(() => {
    const res = this.result();
    return res ? res.cards + res.connections + res.frames : 0;
  });

  private zip: LoadedKlxArchive | null = null;
  private pending: PendingImport | null = null;

  /** Opens the hidden file picker (click on the dropzone or its button). */
  protected pickFile(): void {
    this.fileInput()?.nativeElement.click();
  }

  /** Handles the hidden `<input type="file">` selection, then resets it so the same file can be
   *  re-selected consecutively (the `change` event does not fire on an unchanged value). */
  protected onFileInputChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file) {
      void this.handleFile(file);
    }
    input.value = '';
  }

  protected onDragOver(event: DragEvent): void {
    event.preventDefault();
    this.dragging.set(true);
  }

  protected onDragLeave(): void {
    this.dragging.set(false);
  }

  protected onDrop(event: DragEvent): void {
    event.preventDefault();
    this.dragging.set(false);
    const file = event.dataTransfer?.files?.[0];
    if (file) {
      void this.handleFile(file);
    }
  }

  /** Reads and decompresses the dropped/selected `.klx`, then locates its Activity board(s). */
  private async handleFile(file: File): Promise<void> {
    if (!file.name.toLowerCase().endsWith('.klx')) {
      this.fail('whiteboard.import.error.notKlx');
      return;
    }
    this.step.set('reading');
    try {
      const buffer = await file.arrayBuffer();
      const zip = await JSZip.loadAsync(buffer);
      this.zip = zip;

      const entryPaths = Object.keys(zip.files).filter((p) => !zip.files[p].dir);
      const found = findKlxActivities(entryPaths);

      if (found.length === 0) {
        this.fail('whiteboard.import.error.noBrainstormData');
        return;
      }
      if (found.length === 1) {
        await this.readActivity(found[0]);
        return;
      }
      this.activities.set(found);
      this.step.set('choose');
    } catch {
      this.fail('whiteboard.import.error.corrupted');
    }
  }

  /** Picks an activity from the "choose" step (archive bundling several Klaxoon boards). */
  protected async chooseActivity(activity: KlxActivityEntry): Promise<void> {
    this.step.set('reading');
    await this.readActivity(activity);
  }

  /** Reads one activity's `_brainstorm_data.json` + its `mediabundle/` images, then converts. */
  private async readActivity(activity: KlxActivityEntry): Promise<void> {
    const zip = this.zip;
    if (!zip) {
      return;
    }
    try {
      const jsonText = await zip.files[activity.brainstormPath].async('text');
      const data = JSON.parse(jsonText) as KlxRawData;

      const imagePaths = Object.keys(zip.files).filter((p) => p.startsWith(activity.mediaPrefix) && !zip.files[p].dir);
      const imageMap = new Map<string, string>();
      await Promise.all(imagePaths.map(async (path) => {
        const base64 = await zip.files[path].async('base64');
        imageMap.set(mediaKey(path), `data:${mimeForPath(path)};base64,${base64}`);
      }));

      const { cards, connections, frames, fields, stats } = convertKlaxoon(data, imageMap);
      this.pending = { cards, connections, frames, fields };
      this.stats.set(stats);
      this.step.set('preview');
    } catch {
      this.fail('whiteboard.import.error.corrupted');
    }
  }

  /** Confirms the preview and POSTs the converted content — the first point with a server call. */
  protected runImport(): void {
    const pending = this.pending;
    if (!pending) {
      return;
    }
    this.step.set('importing');
    this.boardService.importKlaxoon(this.boardId(), pending).subscribe({
      next: (res) => {
        this.result.set(res);
        this.step.set('done');
      },
      error: () => this.fail('whiteboard.import.error.importFailed'),
    });
  }

  /**
   * Replays undo with the exact three id lists memorized from the import response, then closes
   * the modal — mirrors the PouetPouet reference (`undoImport()` calls `onClose()` on success).
   */
  protected undoImport(): void {
    const res = this.result();
    if (!res || this.undoing()) {
      return;
    }
    this.undoing.set(true);
    this.boardService.undoImport(this.boardId(), {
      cardIds: res.cardIds,
      connectionIds: res.connectionIds,
      frameIds: res.frameIds,
    }).subscribe({
      next: () => {
        this.undoing.set(false);
        this.close();
      },
      error: () => {
        this.undoing.set(false);
        this.fail('whiteboard.import.error.undoFailed');
      },
    });
  }

  protected close(): void {
    this.closed.emit();
  }

  protected retry(): void {
    this.step.set('pick');
    this.errorKey.set('');
    this.pending = null;
    this.zip = null;
  }

  private fail(key: string): void {
    this.errorKey.set(key);
    this.step.set('error');
  }

  @HostListener('keydown.escape')
  protected onEscape(): void {
    this.close();
  }
}
