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
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { BoardStore } from '../../core/whiteboard/board.store';
import { BoardCardComponent } from '../board-card/board-card.component';
import { FrameItemComponent } from '../frame-item/frame-item.component';
import { ConnectionLineComponent } from '../connection-line/connection-line.component';
import type { Card, Connection } from '../model/board.types';
import { DEFAULT_CARD_COLOR, DEFAULT_SHAPE_COLOR } from '../model/colors';
import { cardDisplayText } from '../model/card-format';
import { isUrlOnlyPaste } from '../model/link-preview';
import {
  computeImageCardSize,
  isEditableTarget,
  isImageClipboardItem,
  loadNaturalSize,
  looksLikeImageFilename,
  readAsDataUrl,
} from '../model/image-card';
import { serializeShape, type ShapeKind } from '../model/shape';
import { serializeTable } from '../model/table';
import { decideTablePaste } from '../model/table-clipboard';
import type { ToolMode } from '../model/tools';
import { SHAPE_TOOLS } from '../model/tools';
import {
  cardRect,
  frameRect,
  pointInRect,
  rectsIntersect,
  screenToCanvas,
  type Rect,
  type Viewport,
} from '../model/board-geometry';
import {
  MIN_W,
  MIN_H,
  SHAPE_MIN,
  MIN_ZOOM,
  MAX_ZOOM,
  DEFAULT_CARD_W,
  DEFAULT_CARD_H,
  LINK_CARD_W,
  LINK_CARD_H,
} from '../model/board-constants';

type Gesture =
  | { kind: 'none' }
  | { kind: 'pan'; startX: number; startY: number; vpX: number; vpY: number }
  | { kind: 'marquee'; startX: number; startY: number }
  | { kind: 'drag-card'; id: string; startX: number; startY: number; startPos: { x: number; y: number } }
  | { kind: 'resize-card'; id: string; dir: string; start: Rect; startX: number; startY: number }
  | { kind: 'drag-frame'; id: string; startX: number; startY: number; startPos: { x: number; y: number }; captured: string[] }
  | { kind: 'resize-frame'; id: string; dir: string; start: Rect; startX: number; startY: number }
  | { kind: 'connect'; fromId: string; x: number; y: number }
  | { kind: 'draw'; points: [number, number][] };

/** A connection with its resolved endpoint rects, ready to render. */
interface RenderConnection {
  conn: Connection;
  fromRect: Rect;
  toRect: Rect;
  /** Short display name of the source/target card, for the connector's descriptive
   *  `aria-label` (US08.7.2 A11y AC) — see {@link StructuredCanvasComponent.endpointLabel}. */
  fromLabel: string;
  toLabel: string;
}

/** Card types whose `content` is not human-readable (data URL, SVG path, encoded shape spec)
 *  — {@link StructuredCanvasComponent.endpointLabel} falls back to a generic label for these. */
const RAW_CONTENT_TYPES = new Set(['IMAGE', 'DRAW', 'SHAPE']);
/** Endpoint label truncation length in {@link StructuredCanvasComponent.endpointLabel}. */
const ENDPOINT_LABEL_MAX = 24;

/**
 * The structured whiteboard surface — the Angular port of PouetPouet's `board-canvas.tsx`.
 *
 * Renders frames, connections and cards inside a pan/zoom-transformed layer (plain DOM/SVG,
 * no canvas/render library — matching the reference) and owns the pointer state machine:
 * viewport pan, wheel zoom, tool-driven card creation, click + marquee selection, card &
 * frame drag/resize, and connection dragging. Card/frame pointer targets are delegated here
 * via their `data-*` attributes, keeping the leaf components presentational.
 *
 * Injects {@link BoardStore} directly (provided by the board container) — it is the
 * integration component, not a transport-agnostic leaf.
 *
 * ⚠️ WIP: freehand smoothing, virtualization, alignment guides and minimap from the
 * reference are not yet ported; the realtime backend only persists the Socle actions today.
 */
@Component({
  selector: 'wb-structured-canvas',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslocoPipe, BoardCardComponent, FrameItemComponent, ConnectionLineComponent],
  templateUrl: './structured-canvas.component.html',
  styleUrl: './structured-canvas.component.scss',
})
export class StructuredCanvasComponent {
  protected readonly store = inject(BoardStore);
  private readonly transloco = inject(TranslocoService);

  /** Active tool (owned by the container/toolbar). */
  readonly tool = input<ToolMode>('select');
  /** Active drawing colour (SHAPE stroke colour). */
  readonly color = input<string>(DEFAULT_SHAPE_COLOR);
  /** Active SHAPE fill colour, or `null` for no fill (US08.6.3). */
  readonly fillColor = input<string | null>(null);

  /** Emitted after a placement tool creates a card, so the container can reset to select. */
  readonly toolConsumed = output<void>();
  /** Requests the card-detail modal. */
  readonly openDetail = output<string>();

  private readonly surface = viewChild.required<ElementRef<HTMLDivElement>>('surface');

  protected readonly viewport = signal<Viewport>({ x: 0, y: 0, zoom: 1 });
  protected readonly marquee = signal<Rect | null>(null);
  protected readonly connectGhost = signal<{ from: { x: number; y: number }; to: { x: number; y: number } } | null>(null);

  protected readonly layerTransform = computed(() => {
    const v = this.viewport();
    return `translate(${v.x}px, ${v.y}px) scale(${v.zoom})`;
  });

  /** Connections with resolved endpoint rects (drops any whose endpoint card is gone). */
  protected readonly renderConnections = computed<RenderConnection[]>(() => {
    const byId = new Map(this.store.cards().map((c) => [c.id, c]));
    return this.store
      .connections()
      .map((conn) => {
        const from = byId.get(conn.fromId);
        const to = byId.get(conn.toId);
        return from && to
          ? {
              conn,
              fromRect: cardRect(from),
              toRect: cardRect(to),
              fromLabel: this.endpointLabel(from),
              toLabel: this.endpointLabel(to),
            }
          : null;
      })
      .filter((c): c is RenderConnection => c !== null);
  });

  /**
   * Short, screen-reader-friendly display name for a connection endpoint card — feeds
   * {@link ConnectionLineComponent}'s descriptive `aria-label` (US08.7.2 A11y AC). Uses the
   * card's plain text for TEXT/LABEL/LINK (truncated); falls back to a generic translated
   * placeholder for {@link RAW_CONTENT_TYPES} (IMAGE/DRAW/SHAPE) whose `content` encoding is
   * not human-readable, and for any card with no readable text at all.
   */
  private endpointLabel(card: Card): string {
    if (!RAW_CONTENT_TYPES.has(card.type)) {
      const text = cardDisplayText(card).trim();
      if (text) {
        return text.length > ENDPOINT_LABEL_MAX ? `${text.slice(0, ENDPOINT_LABEL_MAX)}…` : text;
      }
    }
    return this.transloco.translate('whiteboard.connection.untitledCard');
  }

  private gesture: Gesture = { kind: 'none' };
  private spaceHeld = false;
  /** Last known pointer position in canvas coordinates — the "current position" (US08.6.4)
   *  an image is inserted at on paste or explicit upload. Defaults to a sane in-view point. */
  private lastPointerCanvas = { x: 100, y: 100 };

  // ── Selection helpers ─────────────────────────────────────────────────────
  protected isSelected(id: string): boolean {
    return this.store.selectedIds().has(id);
  }
  protected remoteEditorFor(id: string): string | null {
    return this.store.remoteEditors().get(id)?.name ?? null;
  }

  // ── Coordinate mapping ────────────────────────────────────────────────────
  private toCanvas(clientX: number, clientY: number): { x: number; y: number } {
    const rect = this.surface().nativeElement.getBoundingClientRect();
    return screenToCanvas(clientX - rect.left, clientY - rect.top, this.viewport());
  }

  // ── Keyboard (space pan) ──────────────────────────────────────────────────
  protected onKeyDown(event: KeyboardEvent): void {
    if (event.code === 'Space') {
      this.spaceHeld = true;
    }
  }
  protected onKeyUp(event: KeyboardEvent): void {
    if (event.code === 'Space') {
      this.spaceHeld = false;
    }
  }

  // ── Wheel zoom / pan ──────────────────────────────────────────────────────
  protected onWheel(event: WheelEvent): void {
    event.preventDefault();
    const v = this.viewport();
    if (event.ctrlKey || event.metaKey) {
      const rect = this.surface().nativeElement.getBoundingClientRect();
      const px = event.clientX - rect.left;
      const py = event.clientY - rect.top;
      const factor = event.deltaY < 0 ? 1.1 : 1 / 1.1;
      const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, v.zoom * factor));
      // Zoom toward the cursor.
      const x = px - (px - v.x) * (zoom / v.zoom);
      const y = py - (py - v.y) * (zoom / v.zoom);
      this.viewport.set({ x, y, zoom });
    } else {
      this.viewport.set({ ...v, x: v.x - event.deltaX, y: v.y - event.deltaY });
    }
  }

  // ── Pointer state machine ─────────────────────────────────────────────────
  protected onPointerDown(event: PointerEvent): void {
    if (event.button !== 0) {
      return;
    }
    const target = event.target as HTMLElement;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    const pt = this.toCanvas(event.clientX, event.clientY);

    const resizeEl = target.closest<HTMLElement>('[data-resize-dir]');
    const connectEl = target.closest<HTMLElement>('[data-connect]');
    const frameResizeEl = target.closest<HTMLElement>('[data-frame-resize-dir]');
    const frameDragEl = target.closest<HTMLElement>('[data-frame-drag]');
    const cardEl = target.closest<HTMLElement>('[data-card-id]');
    const readOnly = this.store.isReadonly();

    if (!readOnly && connectEl) {
      const fromId = connectEl.getAttribute('data-card-id') ?? '';
      this.gesture = { kind: 'connect', fromId, x: pt.x, y: pt.y };
      return;
    }
    if (!readOnly && resizeEl) {
      const id = resizeEl.getAttribute('data-card-id') ?? '';
      const card = this.store.cards().find((c) => c.id === id);
      if (card) {
        this.store.startResizeCard(id);
        this.gesture = { kind: 'resize-card', id, dir: resizeEl.getAttribute('data-resize-dir') ?? 'br', start: cardRect(card), startX: pt.x, startY: pt.y };
      }
      return;
    }
    if (!readOnly && frameResizeEl) {
      const id = frameResizeEl.getAttribute('data-frame-id') ?? '';
      const frame = this.store.frames().find((f) => f.id === id);
      if (frame) {
        this.store.startResizeFrame(id);
        this.gesture = { kind: 'resize-frame', id, dir: frameResizeEl.getAttribute('data-frame-resize-dir') ?? 'br', start: frameRect(frame), startX: pt.x, startY: pt.y };
      }
      return;
    }
    if (!readOnly && frameDragEl) {
      const id = frameDragEl.getAttribute('data-frame-id') ?? '';
      const frame = this.store.frames().find((f) => f.id === id);
      if (frame) {
        const captured = frame.active
          ? this.store.cards().filter((c) => !c.locked && pointInRect(c.posX + c.width / 2, c.posY + c.height / 2, frameRect(frame))).map((c) => c.id)
          : [];
        this.store.startDragFrame(id, captured);
        this.gesture = { kind: 'drag-frame', id, startX: pt.x, startY: pt.y, startPos: { x: frame.posX, y: frame.posY }, captured };
      }
      return;
    }
    if (cardEl) {
      const id = cardEl.getAttribute('data-card-id') ?? '';
      const card = this.store.cards().find((c) => c.id === id);
      if (!card) {
        return;
      }
      if (event.shiftKey) {
        const next = new Set(this.store.selectedIds());
        if (next.has(id)) {
          next.delete(id);
        } else {
          next.add(id);
        }
        this.store.selectCards(next);
      } else if (!this.isSelected(id)) {
        this.store.selectCards(new Set([id]));
      }
      if (!readOnly && !card.locked) {
        this.store.startDragCard(id);
        this.gesture = { kind: 'drag-card', id, startX: pt.x, startY: pt.y, startPos: { x: card.posX, y: card.posY } };
      }
      return;
    }

    // Empty canvas.
    const placing = this.placementKind(this.tool());
    if (!readOnly && placing) {
      this.createCard(placing, pt.x, pt.y);
      this.toolConsumed.emit();
      return;
    }
    if (this.tool() === 'draw' && !readOnly) {
      this.gesture = { kind: 'draw', points: [[pt.x, pt.y]] };
      return;
    }
    if (this.tool() === 'pan' || this.spaceHeld) {
      const v = this.viewport();
      this.gesture = { kind: 'pan', startX: event.clientX, startY: event.clientY, vpX: v.x, vpY: v.y };
      return;
    }
    // Marquee select.
    if (!event.shiftKey) {
      this.store.selectCards(new Set());
    }
    this.gesture = { kind: 'marquee', startX: pt.x, startY: pt.y };
  }

  protected onPointerMove(event: PointerEvent): void {
    const pt = this.toCanvas(event.clientX, event.clientY);
    this.lastPointerCanvas = pt;
    this.store.emitCursor(pt.x, pt.y);
    const g = this.gesture;
    switch (g.kind) {
      case 'pan':
        this.viewport.set({ ...this.viewport(), x: g.vpX + (event.clientX - g.startX), y: g.vpY + (event.clientY - g.startY) });
        break;
      case 'drag-card':
        this.store.moveCard(g.id, g.startPos.x + (pt.x - g.startX), g.startPos.y + (pt.y - g.startY));
        break;
      case 'resize-card':
        this.applyCardResize(g, pt.x, pt.y);
        break;
      case 'drag-frame':
        this.applyFrameDrag(g, pt.x, pt.y);
        break;
      case 'resize-frame':
        this.applyFrameResize(g, pt.x, pt.y);
        break;
      case 'connect':
        this.gesture = { ...g, x: pt.x, y: pt.y };
        this.updateConnectGhost(g.fromId, pt.x, pt.y);
        break;
      case 'marquee':
        this.marquee.set(this.normRect(g.startX, g.startY, pt.x, pt.y));
        this.applyMarquee();
        break;
      case 'draw':
        g.points.push([pt.x, pt.y]);
        break;
      default:
        break;
    }
  }

  protected onPointerUp(event: PointerEvent): void {
    const g = this.gesture;
    (event.currentTarget as HTMLElement).releasePointerCapture?.(event.pointerId);
    switch (g.kind) {
      case 'drag-card':
        this.store.commitDragCard();
        break;
      case 'resize-card':
        this.store.commitResizeCard(g.id);
        break;
      case 'drag-frame':
        this.store.commitDragFrame(g.id);
        break;
      case 'resize-frame':
        this.store.commitResizeFrame(g.id);
        break;
      case 'connect':
        this.finishConnect(event);
        break;
      case 'draw':
        this.finishDraw(g.points);
        break;
      case 'marquee':
        this.marquee.set(null);
        break;
      default:
        break;
    }
    this.gesture = { kind: 'none' };
  }

  // ── Gesture application ───────────────────────────────────────────────────
  private applyCardResize(g: Extract<Gesture, { kind: 'resize-card' }>, x: number, y: number): void {
    const box = this.resizeRect(g.start, g.dir, x - g.startX, y - g.startY, SHAPE_MIN, SHAPE_MIN);
    this.store.resizeCardBox(g.id, { posX: box.x, posY: box.y, width: box.width, height: box.height });
  }
  private applyFrameResize(g: Extract<Gesture, { kind: 'resize-frame' }>, x: number, y: number): void {
    const box = this.resizeRect(g.start, g.dir, x - g.startX, y - g.startY, MIN_W, MIN_H);
    this.store.resizeFrameBox(g.id, box.x, box.y, box.width, box.height);
  }
  private applyFrameDrag(g: Extract<Gesture, { kind: 'drag-frame' }>, x: number, y: number): void {
    const nx = g.startPos.x + (x - g.startX);
    const ny = g.startPos.y + (y - g.startY);
    const captured = g.captured.map((id) => {
      const c = this.store.cards().find((cc) => cc.id === id);
      return c ? { id, startX: c.posX, startY: c.posY, frameStartX: g.startPos.x, frameStartY: g.startPos.y } : null;
    });
    // moveFrame recomputes card deltas from the frame start; pass the frame's origin.
    this.store.moveFrame(g.id, nx, ny, captured.filter((c): c is NonNullable<typeof c> => c !== null).map((c) => ({ ...c, frameStartX: g.startPos.x, frameStartY: g.startPos.y })));
  }

  private resizeRect(start: Rect, dir: string, dx: number, dy: number, minW: number, minH: number): Rect {
    let { x, y, width, height } = start;
    if (dir.includes('r')) {
      width = Math.max(minW, start.width + dx);
    }
    if (dir.includes('l')) {
      const w = Math.max(minW, start.width - dx);
      x = start.x + (start.width - w);
      width = w;
    }
    if (dir.includes('b')) {
      height = Math.max(minH, start.height + dy);
    }
    if (dir.includes('t')) {
      const h = Math.max(minH, start.height - dy);
      y = start.y + (start.height - h);
      height = h;
    }
    return { x, y, width, height };
  }

  private applyMarquee(): void {
    const box = this.marquee();
    if (!box) {
      return;
    }
    const hit = this.store.cards().filter((c) => rectsIntersect(cardRect(c), box)).map((c) => c.id);
    this.store.selectCards(new Set(hit));
  }

  private updateConnectGhost(fromId: string, x: number, y: number): void {
    const from = this.store.cards().find((c) => c.id === fromId);
    if (!from) {
      return;
    }
    this.connectGhost.set({ from: { x: from.posX + from.width / 2, y: from.posY + from.height / 2 }, to: { x, y } });
  }

  private finishConnect(event: PointerEvent): void {
    this.connectGhost.set(null);
    const g = this.gesture;
    if (g.kind !== 'connect') {
      return;
    }
    const target = (event.target as HTMLElement).closest<HTMLElement>('[data-card-id]');
    const toId = target?.getAttribute('data-card-id');
    if (toId && toId !== g.fromId) {
      this.store.addConnection(g.fromId, toId);
    }
  }

  private finishDraw(points: [number, number][]): void {
    if (points.length < 2) {
      return;
    }
    const xs = points.map((p) => p[0]);
    const ys = points.map((p) => p[1]);
    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    const width = Math.max(1, Math.max(...xs) - minX);
    const height = Math.max(1, Math.max(...ys) - minY);
    const d = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${(p[0] - minX).toFixed(1)},${(p[1] - minY).toFixed(1)}`).join(' ');
    this.store.addCard(minX, minY, 'DRAW', d, this.color(), width, height);
    this.toolConsumed.emit();
  }

  /** Id of the single selected TABLE card, or `null` when 0 or >1 cards are selected. */
  private singleSelectedTableCardId(): string | null {
    const ids = Array.from(this.store.selectedIds());
    if (ids.length !== 1) {
      return null;
    }
    const card = this.store.cards().find((c) => c.id === ids[0]);
    return card?.type === 'TABLE' ? card.id : null;
  }

  /** Canvas coordinates of the visible surface's centre — where a pasted-and-created card
   *  is placed, mirroring how other placement tools centre a new card on the click point. */
  private pasteTargetCenter(): { x: number; y: number } {
    const rect = this.surface().nativeElement.getBoundingClientRect();
    return screenToCanvas(rect.width / 2, rect.height / 2, this.viewport());
  }

  // ── Card creation ─────────────────────────────────────────────────────────
  private placementKind(tool: ToolMode): 'sticky' | 'text' | 'table' | 'shape' | null {
    if (tool === 'sticky' || tool === 'text' || tool === 'table') {
      return tool;
    }
    if (SHAPE_TOOLS[tool]) {
      return 'shape';
    }
    return null;
  }

  private createCard(kind: 'sticky' | 'text' | 'table' | 'shape', x: number, y: number): void {
    const px = x - DEFAULT_CARD_W / 2;
    const py = y - DEFAULT_CARD_H / 2;
    if (kind === 'sticky') {
      this.store.addCard(px, py, 'TEXT', '', DEFAULT_CARD_COLOR, DEFAULT_CARD_W, DEFAULT_CARD_H);
    } else if (kind === 'text') {
      // 'text' is the LABEL placement tool (US08.6.2) — a compact, persistent text label
      // distinct from the 'sticky' post-it (TEXT). Server-side defaults are unchanged
      // (192×128, #FFEB3B, EN08.4); only the client renders it without a post-it background
      // (see BoardCardComponent's `type === 'LABEL'` case).
      this.store.addCard(px, py, 'LABEL', '', DEFAULT_CARD_COLOR, DEFAULT_CARD_W, DEFAULT_CARD_H);
    } else if (kind === 'table') {
      this.store.addCard(px, py, 'TABLE', serializeTable([['', '', ''], ['', '', ''], ['', '', '']]), '#FFFFFF', 240, 140);
    } else {
      const shapeKind = SHAPE_TOOLS[this.tool()] as ShapeKind;
      // Fill (US08.6.3, second colour picker) defaults to `null` (no fill, outline-only) —
      // the SHAPE default — unless the user picked one in the floating toolbar.
      const content = serializeShape({ kind: shapeKind, stroke: this.color(), fill: this.fillColor(), opacity: 1, rotation: 0 });
      this.store.addCard(px, py, 'SHAPE', content, this.color(), 120, 120);
    }
  }

  // ── Image insertion (US08.6.4: clipboard paste + explicit upload) ──────────

  /**
   * Explicit-upload entry point (floating-toolbar "insert image" button, via the container).
   * Inserts the file as an `IMAGE` card at the last known pointer position, with the same
   * dimensioning as a clipboard paste.
   */
  async insertImageFile(file: File): Promise<void> {
    if (this.store.isReadonly()) {
      return;
    }
    await this.createImageCardFromFile(file, this.lastPointerCanvas.x, this.lastPointerCanvas.y);
  }

  /**
   * Native OS clipboard paste — resolves what to do with pasted content when focus is on the
   * canvas, not an editable control (an input/textarea/contentEditable other than a TABLE
   * cell mid-edit, or a card's own inline text editor), so pasting into an existing field is
   * never hijacked into spawning a new card. Priority order (parity spec §4.8):
   * 1. Tabular content (HTML `<table>` or TSV) with a focused TABLE cell → fills that card's
   *    grid (US08.6.6, rank 1); with a single TABLE card selected → fills it; otherwise →
   *    creates a new dimensioned TABLE card (rank 4). See {@link decideTablePaste}.
   * 2. A pasted file whose declared MIME type is `image/*`, or (repli) whose filename matches
   *    the recognised image extensions → a dimensioned `IMAGE` card (US08.6.4, case 3) — never
   *    reached if rank 1 already matched (a file paste has no meaningful text/html for
   *    {@link decideTablePaste} to recognise as a table).
   * 3. Non-tabular text that is a URL and nothing else → a `LINK` card (US08.6.5, parity spec
   *    §1.5/§3.4).
   * 4. Any other non-tabular pasted text → the Error-case fallback: a `TEXT` card (US08.6.4/
   *    US08.6.1) — HTML/TSV was already ruled out as a table above.
   */
  @HostListener('document:paste', ['$event'])
  protected async onPaste(event: ClipboardEvent): Promise<void> {
    if (this.store.isReadonly()) {
      return;
    }
    const clipboardData = event.clipboardData;
    if (!clipboardData) {
      return;
    }
    // `event.target` reflects the browser's real paste target, but tests dispatch paste
    // events on `document` directly (`document.dispatchEvent`), which makes `event.target`
    // resolve to `document` itself regardless of which element actually has focus.
    // `document.activeElement` is what genuinely tracks focus in both cases, so it's the
    // only reliable signal for "is an editable field currently focused".
    const activeEl = document.activeElement instanceof Element ? (document.activeElement as HTMLElement) : null;
    const tableCellEl = activeEl?.closest<HTMLElement>('[data-wb-table-cell]') ?? null;
    const focusedTableCardId = tableCellEl?.closest<HTMLElement>('[data-card-id]')?.getAttribute('data-card-id') ?? null;

    const tableAction = decideTablePaste({
      html: clipboardData.getData('text/html'),
      text: clipboardData.getData('text/plain'),
      focusedTableCardId,
      singleSelectedTableCardId: this.singleSelectedTableCardId(),
      isEditableFieldFocus: isEditableTarget(activeEl),
    });

    if (tableAction.kind === 'fill') {
      event.preventDefault();
      // Rank 1 may fire while that very cell is mid-edit locally (its own inline `<input>`
      // still holds a stale, uncommitted value) — force-flush it first so our authoritative
      // fill is applied last and wins (board-card commits on blur).
      tableCellEl?.blur();
      this.store.updateCard(tableAction.cardId, serializeTable(tableAction.rows));
      return;
    }
    if (tableAction.kind === 'create') {
      event.preventDefault();
      const center = this.pasteTargetCenter();
      this.store.addCard(
        center.x - tableAction.width / 2,
        center.y - tableAction.height / 2,
        'TABLE',
        serializeTable(tableAction.rows),
        '#FFFFFF',
        tableAction.width,
        tableAction.height,
      );
      return;
    }

    // Neither a table fill nor a table creation — either a genuinely editable field owns
    // this paste natively, or the content isn't tabular. Re-check the editable-field guard
    // explicitly: decideTablePaste already returns 'none' for a pure image/file paste
    // (no recognisable text/html), so this is the one guard the table logic can't cover.
    if (isEditableTarget(activeEl)) {
      return;
    }

    const file = this.resolvePastedImageFile(clipboardData);
    if (file) {
      event.preventDefault();
      await this.createImageCardFromFile(file, this.lastPointerCanvas.x, this.lastPointerCanvas.y);
      return;
    }

    if (tableAction.kind !== 'fallback-text') {
      return;
    }
    event.preventDefault();
    if (isUrlOnlyPaste(tableAction.text)) {
      const rect = this.surface().nativeElement.getBoundingClientRect();
      const center = this.toCanvas(rect.left + rect.width / 2, rect.top + rect.height / 2);
      this.store.addCard(
        center.x - LINK_CARD_W / 2,
        center.y - LINK_CARD_H / 2,
        'LINK',
        tableAction.text,
        DEFAULT_CARD_COLOR,
        LINK_CARD_W,
        LINK_CARD_H,
      );
      return;
    }
    const px = this.lastPointerCanvas.x - DEFAULT_CARD_W / 2;
    const py = this.lastPointerCanvas.y - DEFAULT_CARD_H / 2;
    this.store.addCard(px, py, 'TEXT', tableAction.text, DEFAULT_CARD_COLOR, DEFAULT_CARD_W, DEFAULT_CARD_H);
  }

  /** Resolves a pasted file as an image: declared MIME type first, filename extension repli. */
  private resolvePastedImageFile(clipboardData: DataTransfer): File | null {
    const items = Array.from(clipboardData.items);
    const byMime = items.find((item) => isImageClipboardItem(item));
    if (byMime) {
      return byMime.getAsFile();
    }
    const anyFile = items.find((item) => item.kind === 'file');
    const candidate = anyFile?.getAsFile() ?? null;
    return candidate && looksLikeImageFilename(candidate.name) ? candidate : null;
  }

  /** Reads, dimensions (parity spec §7: `min(700/w, 600/h, 1)`) and creates an `IMAGE` card
   *  centred on `(x, y)`. Silently does nothing if the file cannot be decoded as an image. */
  private async createImageCardFromFile(file: File, x: number, y: number): Promise<void> {
    let dataUrl: string;
    try {
      dataUrl = await readAsDataUrl(file);
    } catch {
      return;
    }
    let naturalW: number;
    let naturalH: number;
    try {
      ({ naturalW, naturalH } = await loadNaturalSize(dataUrl));
    } catch {
      return;
    }
    const { width, height } = computeImageCardSize(naturalW, naturalH);
    this.store.addCard(x - width / 2, y - height / 2, 'IMAGE', dataUrl, undefined, width, height);
  }

  // ── Small geometry ───────────────────────────────────────────────────────
  private normRect(x1: number, y1: number, x2: number, y2: number): Rect {
    return { x: Math.min(x1, x2), y: Math.min(y1, y2), width: Math.abs(x2 - x1), height: Math.abs(y2 - y1) };
  }

  protected trackCard = (_: number, c: Card): string => c.id;

  // ── Card event relays ─────────────────────────────────────────────────────
  protected onCardContent(card: Card, content: string): void {
    this.store.updateCard(card.id, content);
  }
  protected onCardEditing(card: Card, editing: boolean): void {
    this.store.notifyEditing(card.id, editing);
  }
  protected onFrameTitle(id: string, title: string): void {
    this.store.updateFrame(id, title);
  }
  protected onFrameActive(id: string, active: boolean): void {
    this.store.setFrameActive(id, active);
  }
  protected onConnectionSelect(id: string): void {
    this.store.selectCards(new Set([id]));
  }
}
