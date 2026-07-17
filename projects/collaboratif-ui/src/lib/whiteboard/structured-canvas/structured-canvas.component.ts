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
import type { Card, Connection, ConnCap, ConnLineStyle } from '../model/board.types';
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
import { parseShape, serializeShape, type ShapeDiag, type ShapeKind } from '../model/shape';
import { serializeTable } from '../model/table';
import { decideTablePaste } from '../model/table-clipboard';
import type { ToolMode } from '../model/tools';
import { SHAPE_TOOLS } from '../model/tools';
import {
  CARDINAL_SIDES,
  cardRect,
  edgeAnchor,
  edgeAnchorPoint,
  frameRect,
  pointInRect,
  rectsIntersect,
  screenToCanvas,
  type EdgeSide,
  type Rect,
  type Viewport,
} from '../model/board-geometry';
import {
  MIN_W,
  MIN_H,
  SHAPE_MIN,
  LINE_MIN,
  LINE_SNAP_DEG,
  LINE_MIN_DRAG,
  MIN_ZOOM,
  MAX_ZOOM,
  DOT_SPACING,
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
  | {
      kind: 'resize-card';
      id: string;
      dir: string;
      start: Rect;
      startX: number;
      startY: number;
      lineDiag?: ShapeDiag;
      lineContent?: string;
    }
  | { kind: 'drag-frame'; id: string; startX: number; startY: number; startPos: { x: number; y: number }; captured: string[] }
  | { kind: 'resize-frame'; id: string; dir: string; start: Rect; startX: number; startY: number }
  | { kind: 'connect'; fromId: string; fromSide: EdgeSide | null; x: number; y: number }
  | { kind: 'draw'; points: [number, number][] }
  | { kind: 'draw-line'; startX: number; startY: number; x: number; y: number };

/**
 * Modifiers held during a resize gesture.
 *
 * @property ratio      Shift — keep the gesture's start aspect ratio (corner handles only).
 * @property fromCenter Alt — grow around the start centre instead of the opposite corner.
 */
interface ResizeOpts {
  ratio?: boolean;
  fromCenter?: boolean;
}

/** A single edge-anchor pastille shown on a hovered target card while linking (ITEM B). */
interface AnchorPastille {
  side: EdgeSide;
  x: number;
  y: number;
}

/**
 * The hovered target card's anchor pastilles + the side the connector will actually attach to,
 * during a connect drag. `attach` is the routing-resolved anchor (the side of the target facing the
 * source card's centre — see {@link edgeAnchor}), NOT the pastille nearest the cursor: the
 * highlighted dot must be where the line really lands ("what you see is what you get").
 */
interface HoverAnchors {
  cardId: string;
  points: AnchorPastille[];
  attach: EdgeSide;
}

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
  /**
   * True once the user actively picked a colour (toolbar swatch or selection recolour). A colour
   * picked that way applies to whatever is created next, whatever its type; until then each card
   * type keeps its own default — {@link color} defaults to the *shape* colour, so inheriting it
   * unconditionally would turn fresh post-its indigo instead of soft yellow.
   */
  readonly colorPicked = input<boolean>(false);
  /** Active SHAPE fill colour, or `null` for no fill (US08.6.3). */
  readonly fillColor = input<string | null>(null);
  /** Caps picked in the toolbar, applied to the next connector drawn (US08.7.2). */
  readonly connectorStartCap = input<ConnCap>('none');
  readonly connectorEndCap = input<ConnCap>('none');
  /** Line style picked in the toolbar, applied to the next connector drawn. */
  readonly connectorLineStyle = input<ConnLineStyle>('solid');

  /** Emitted after a placement tool creates a card, so the container can reset to select. */
  readonly toolConsumed = output<void>();
  /** Requests the card-detail modal. */
  readonly openDetail = output<string>();

  private readonly surface = viewChild.required<ElementRef<HTMLDivElement>>('surface');

  protected readonly viewport = signal<Viewport>({ x: 0, y: 0, zoom: 1 });
  protected readonly marquee = signal<Rect | null>(null);
  protected readonly connectGhost = signal<{ from: { x: number; y: number }; to: { x: number; y: number } } | null>(null);
  /** Anchor pastilles shown on the card currently hovered during a connect drag (ITEM B). */
  protected readonly hoverAnchors = signal<HoverAnchors | null>(null);
  /**
   * Live SVG `d` path of the free-draw stroke currently being traced, in canvas coordinates, or
   * `null` when not drawing. Rendered in the overlay so the user sees the stroke grow in real time
   * (each `pointermove` updates it) instead of only on release when {@link finishDraw} commits the
   * DRAW card. The `gesture.points` array alone is not reactive, so it cannot drive rendering.
   */
  protected readonly drawPreview = signal<string | null>(null);
  /**
   * Live endpoints of the line currently being dragged, in canvas coordinates, or `null` when not
   * drawing one. Same reason as {@link drawPreview}: the gesture object is not reactive, so the
   * preview needs its own signal to render as the pointer moves.
   */
  protected readonly linePreview = signal<{ x1: number; y1: number; x2: number; y2: number } | null>(null);

  protected readonly layerTransform = computed(() => {
    const v = this.viewport();
    return `translate(${v.x}px, ${v.y}px) scale(${v.zoom})`;
  });

  /**
   * Dotted-grid metrics for the viewport-covering surface (ITEM 1). The dot spacing scales with
   * zoom and the pattern origin follows the pan offset, so the grid stays crisp and moves/scales
   * with the canvas — mirroring PouetPouet's `backgroundSize`/`backgroundPosition` on the board
   * container (`board-canvas.tsx`), where `d = DOT_SPACING * zoom` and the origin is `vp.{x,y} % d`.
   */
  protected readonly gridSize = computed(() => {
    const d = DOT_SPACING * this.viewport().zoom;
    return `${d}px ${d}px`;
  });
  protected readonly gridPosition = computed(() => {
    const v = this.viewport();
    const d = DOT_SPACING * v.zoom;
    return `${v.x % d}px ${v.y % d}px`;
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

  /**
   * Selection on pointer-down, shared by cards and frames: `additive` (Shift held) toggles the
   * item within the current selection, a plain click selects it alone — and leaves an existing
   * multi-selection untouched when the item is already part of it, so dragging a group keeps it
   * together.
   */
  private selectItem(id: string, additive: boolean): void {
    if (additive) {
      const next = new Set(this.store.selectedIds());
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      this.store.selectCards(next);
      return;
    }
    if (!this.isSelected(id)) {
      this.store.selectCards(new Set([id]));
    }
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
    // ITEM H — the middle mouse button (wheel click) pans the canvas exactly like space+drag or
    // the pan tool, whatever the active tool is. Routed first, before any card/placement/marquee
    // logic, and `preventDefault`-ed to suppress the browser's default middle-click autoscroll.
    if (event.button === 1) {
      event.preventDefault();
      (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
      const v = this.viewport();
      this.gesture = { kind: 'pan', startX: event.clientX, startY: event.clientY, vpX: v.x, vpY: v.y };
      return;
    }
    if (event.button !== 0) {
      return;
    }
    const target = event.target as HTMLElement;
    // A control is not a canvas gesture. The frame header carries `data-frame-drag`, and its
    // buttons (z-order, magnet, delete) and title live inside it — starting a drag here captures
    // the pointer on the surface, so the `click`/`dblclick` never reaches the control and it looks
    // dead. Bail out before any gesture so the control gets its event.
    if (target.closest('button, input, textarea, select, [contenteditable="true"]')) {
      return;
    }
    // A connector owns its own pointer story: selection on `click`, label edit on `dblclick`. No
    // canvas gesture may start here — a marquee born on the second `pointerdown` of a double-click
    // ends with a degenerate rect that clears the selection right before the `dblclick` fires.
    if (target.closest('[data-connection-hit], [data-connection-label]')) {
      return;
    }
    // The frame title doubles as the frame's drag handle *and* as the rename target (double-click).
    // Capturing routes every subsequent mouse event to the surface, so its `dblclick` never fires —
    // measured: the span saw two `pointerdown` and no `click` at all. Dragging still works without
    // the capture, since the surface spans the whole board and keeps receiving the moves; only a
    // drag continued *outside the window* is lost, which is not worth an unrenamable frame.
    if (!target.closest('[data-frame-title]')) {
      (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    }
    const pt = this.toCanvas(event.clientX, event.clientY);

    const resizeEl = target.closest<HTMLElement>('[data-resize-dir]');
    const connectEl = target.closest<HTMLElement>('[data-connect]');
    const frameResizeEl = target.closest<HTMLElement>('[data-frame-resize-dir]');
    const frameDragEl = target.closest<HTMLElement>('[data-frame-drag]');
    const cardEl = target.closest<HTMLElement>('[data-card-id]');
    const readOnly = this.store.isReadonly();

    if (!readOnly && connectEl) {
      const fromId = connectEl.getAttribute('data-card-id') ?? '';
      // The grabbed handle's side (`data-connect="N|E|S|W"`) seeds the ghost's start point so the
      // line leaves the exact anchor the user dragged from, not always the card centre.
      const fromSide = this.parseSide(connectEl.getAttribute('data-connect'));
      this.gesture = { kind: 'connect', fromId, fromSide, x: pt.x, y: pt.y };
      return;
    }
    if (!readOnly && resizeEl) {
      const id = resizeEl.getAttribute('data-card-id') ?? '';
      const card = this.store.cards().find((c) => c.id === id);
      if (card) {
        this.store.startResizeCard(id);
        const spec = card.type === 'SHAPE' ? parseShape(card.content) : null;
        this.gesture = {
          kind: 'resize-card',
          id,
          dir: resizeEl.getAttribute('data-resize-dir') ?? 'br',
          start: cardRect(card),
          startX: pt.x,
          startY: pt.y,
          // Present only for a line — that is what routes the gesture to the endpoint logic.
          lineDiag: spec?.kind === 'line' ? spec.diag : undefined,
          // The content as it was before the gesture: the undo target, and the reference that says
          // whether the diagonal actually changed.
          lineContent: spec?.kind === 'line' ? card.content : undefined,
        };
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
        // Selecting the frame is what reveals its resize handles (`@if (selected())`) and lets
        // Delete remove it — without this, a frame was never in `selectedIds`, so both were
        // unreachable even though the machinery existed (US08.8.1/.2). Mirrors the card path:
        // Shift toggles within the selection, a plain click selects the frame alone.
        this.selectItem(id, event.shiftKey);
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
      this.selectItem(id, event.shiftKey);
      if (!readOnly && !card.locked) {
        this.store.startDragCard(id);
        this.gesture = { kind: 'drag-card', id, startX: pt.x, startY: pt.y, startPos: { x: card.posX, y: card.posY } };
      }
      return;
    }

    // Empty canvas.
    // The line tool is dragged, not clicked (Figma/Miro/Klaxoon behaviour) — routed before the
    // click-to-place branch that every other shape still takes. Clicking a line into a fixed
    // 120×120 box was what made it "horizontal forcé" with a square selection outline.
    if (!readOnly && this.tool() === 'line') {
      this.gesture = { kind: 'draw-line', startX: pt.x, startY: pt.y, x: pt.x, y: pt.y };
      return;
    }
    const placing = this.placementKind(this.tool());
    if (!readOnly && placing) {
      if (placing === 'frame') {
        // Frames have no client-known default size (the server assigns width/height on
        // `frame:create` — see BoardStore.addFrame), so the click point is used directly as
        // the frame's top-left corner (Frame.posX/posY), unlike card placement which centres
        // a client-known W×H on the click point.
        this.store.addFrame(pt.x, pt.y);
      } else {
        this.createCard(placing, pt.x, pt.y);
      }
      this.toolConsumed.emit();
      return;
    }
    if (this.tool() === 'draw' && !readOnly) {
      this.gesture = { kind: 'draw', points: [[pt.x, pt.y]] };
      this.drawPreview.set(this.drawPath([[pt.x, pt.y]]));
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
        this.applyCardResize(g, pt.x, pt.y, this.resizeOpts(event));
        break;
      case 'drag-frame':
        this.applyFrameDrag(g, pt.x, pt.y);
        break;
      case 'resize-frame':
        this.applyFrameResize(g, pt.x, pt.y, this.resizeOpts(event));
        break;
      case 'connect':
        this.gesture = { ...g, x: pt.x, y: pt.y };
        this.updateConnectHover(event, g.fromId);
        this.updateConnectGhost(g, pt.x, pt.y);
        break;
      case 'marquee':
        this.marquee.set(this.normRect(g.startX, g.startY, pt.x, pt.y));
        this.applyMarquee();
        break;
      case 'draw':
        g.points.push([pt.x, pt.y]);
        // Reflect the growing stroke live so the user sees what they draw as they draw it, not
        // only once the pointer is released (the raw `g.points` array is not reactive).
        this.drawPreview.set(this.drawPath(g.points));
        break;
      case 'draw-line': {
        const end = event.shiftKey ? this.snapAngle(g.startX, g.startY, pt.x, pt.y) : pt;
        this.gesture = { ...g, x: end.x, y: end.y };
        this.linePreview.set({ x1: g.startX, y1: g.startY, x2: end.x, y2: end.y });
        break;
      }
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
        this.commitLineDiag(g);
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
        // Clear the live preview: from here the committed DRAW card renders the stroke.
        this.drawPreview.set(null);
        this.finishDraw(g.points);
        break;
      case 'draw-line':
        this.linePreview.set(null);
        this.finishLine(g);
        break;
      case 'marquee':
        this.marquee.set(null);
        break;
      default:
        break;
    }
    this.gesture = { kind: 'none' };
  }

  /**
   * ITEM D — double-clicking empty canvas creates a post-it centred on that point (PouetPouet
   * parity, `board-canvas.tsx` `handleCanvasDoubleClick`). Fires only in the default `select`
   * tool and only over the empty surface: a double-click on a card, frame or connector is left
   * to that element (a card opens its inline editor via board-card), so the guard skips any
   * `data-card-id` / `data-frame-*` / connector target that the event bubbled up from.
   */
  protected onDoubleClick(event: MouseEvent): void {
    if (this.store.isReadonly() || this.tool() !== 'select') {
      return;
    }
    // `event.target` is unreliable here: onPointerDown calls setPointerCapture on the surface, so
    // the dblclick's target is redirected to `.wb-surface` even when the cursor is over a card —
    // the guard would then never match. Hit-test the real element under the pointer instead
    // (same technique as the connector drop), so a double-click on a card/frame/connector is left
    // to that element (a card opens its inline editor) and never spawns a stray post-it.
    const hit = document.elementFromPoint(event.clientX, event.clientY) as HTMLElement | null;
    const cardEl = hit?.closest('[data-card-id]') as HTMLElement | null;
    if (cardEl) {
      // The card's own (dblclick)="startEdit()" never fires here — setPointerCapture on the
      // surface swallowed the event — so open its inline editor from the canvas instead, using
      // the card id under the pointer. Never spawns a stray post-it.
      const cardId = cardEl.getAttribute('data-card-id');
      if (cardId) {
        this.store.requestEdit(cardId);
      }
      return;
    }
    if (hit?.closest('[data-frame-id], [data-frame-drag], [wbConnectionLine]')) {
      return;
    }
    const pt = this.toCanvas(event.clientX, event.clientY);
    this.store.addCard(
      pt.x - DEFAULT_CARD_W / 2,
      pt.y - DEFAULT_CARD_H / 2,
      'TEXT',
      '',
      this.newCardColor(DEFAULT_CARD_COLOR),
      DEFAULT_CARD_W,
      DEFAULT_CARD_H,
    );
  }

  // ── Gesture application ───────────────────────────────────────────────────
  /** Resize modifiers, read live on every move so they can be pressed or released mid-drag. */
  private resizeOpts(event: PointerEvent): ResizeOpts {
    return { ratio: event.shiftKey, fromCenter: event.altKey };
  }
  /**
   * Resize floor for a card. A `line` is the diagonal of its box, so it must be allowed to go flat
   * on an axis to stay straight; {@link SHAPE_MIN} on both axes would forbid a horizontal or
   * vertical line outright.
   */
  private minSizeFor(id: string): number {
    const card = this.store.cards().find((c) => c.id === id);
    return card?.type === 'SHAPE' && parseShape(card.content).kind === 'line' ? LINE_MIN : SHAPE_MIN;
  }
  private applyCardResize(g: Extract<Gesture, { kind: 'resize-card' }>, x: number, y: number, opts: ResizeOpts = {}): void {
    if (g.lineDiag) {
      this.applyLineResize(g, x, y, opts);
      return;
    }
    const min = this.minSizeFor(g.id);
    const box = this.resizeRect(g.start, g.dir, x - g.startX, y - g.startY, min, min, opts);
    this.store.resizeCardBox(g.id, { posX: box.x, posY: box.y, width: box.width, height: box.height });
  }

  /**
   * Resizes a line by moving the endpoint being dragged, the other staying put — a line is two
   * points, so box semantics do not apply to it. Dragging one end past the other is a normal
   * gesture and simply flips the diagonal; going through {@link resizeRect} instead would clamp at
   * the minimum and the line would refuse to turn over.
   *
   * The new diagonal is kept on the gesture and written to `content` once, on release
   * ({@link onPointerUp}) — rewriting it on every move would emit a `card:update` per pixel.
   */
  private applyLineResize(g: Extract<Gesture, { kind: 'resize-card' }>, x: number, y: number, opts: ResizeOpts = {}): void {
    // The fixed end is the corner opposite the handle being dragged.
    const fx = g.dir.includes('l') ? g.start.x + g.start.width : g.start.x;
    const fy = g.dir.includes('t') ? g.start.y + g.start.height : g.start.y;
    const end = opts.ratio ? this.snapAngle(fx, fy, x, y) : { x, y };
    const box = this.normRect(fx, fy, end.x, end.y);
    // Both signs together → top-left→bottom-right; crossed → the other diagonal.
    const diag: ShapeDiag = (end.x - fx) * (end.y - fy) >= 0 ? 'tlbr' : 'bltr';
    this.gesture = { ...g, lineDiag: diag };
    const live = this.store.cards().find((c) => c.id === g.id);
    if (live && parseShape(live.content).diag !== diag) {
      // Repaint locally on every move: the line is drawn along whichever diagonal `content` names,
      // so leaving it stale while swinging an endpoint around the fixed one draws it on the wrong
      // diagonal, and *both* ends appear to move. Emitted once, on release.
      this.store.previewCardContent(g.id, serializeShape({ ...parseShape(g.lineContent ?? ''), diag }));
    }
    this.store.resizeCardBox(g.id, {
      posX: box.x,
      posY: box.y,
      // Never zero on either axis: a flat box renders nothing at all (see LINE_MIN).
      width: Math.max(LINE_MIN, box.width),
      height: Math.max(LINE_MIN, box.height),
    });
  }
  private applyFrameResize(g: Extract<Gesture, { kind: 'resize-frame' }>, x: number, y: number, opts: ResizeOpts = {}): void {
    const box = this.resizeRect(g.start, g.dir, x - g.startX, y - g.startY, MIN_W, MIN_H, opts);
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

  /**
   * Geometry of a resize gesture.
   *
   * @param opts.ratio      Shift held — keep the start aspect ratio. Corner handles only: on a
   *                        side handle (`t`/`b`/`l`/`r`) a locked ratio is undefined, so Shift is
   *                        ignored there, as in Figma.
   * @param opts.fromCenter Alt held — grow around the start centre instead of the opposite corner,
   *                        so the drag delta applies to both sides at once.
   */
  private resizeRect(
    start: Rect,
    dir: string,
    dx: number,
    dy: number,
    minW: number,
    minH: number,
    opts: ResizeOpts = {},
  ): Rect {
    // Resizing from the centre moves the opposite edge by the same amount, so one pointer unit
    // changes the size by two.
    const k = opts.fromCenter ? 2 : 1;
    let { x, y, width, height } = start;
    if (dir.includes('r')) {
      width = Math.max(minW, start.width + dx * k);
    }
    if (dir.includes('l')) {
      const w = Math.max(minW, start.width - dx * k);
      x = start.x + (start.width - w);
      width = w;
    }
    if (dir.includes('b')) {
      height = Math.max(minH, start.height + dy * k);
    }
    if (dir.includes('t')) {
      const h = Math.max(minH, start.height - dy * k);
      y = start.y + (start.height - h);
      height = h;
    }

    if (opts.ratio && dir.length === 2) {
      // The ratio is the gesture's starting one, never recomputed mid-drag — recomputing from the
      // live box would let rounding drift the shape a little more on every pointer move.
      const ratio = start.width / start.height;
      // The axis the pointer pushed furthest (relative to its own start) drives the scale, so the
      // shape follows the dominant direction of the drag rather than one hard-coded axis.
      const scale = Math.max(width / start.width, height / start.height);
      let w = Math.max(minW, start.width * scale);
      let h = Math.max(minH, start.height * scale);
      // Restore the exact ratio after the min clamps, which may have moved only one axis.
      if (w / h > ratio) {
        h = w / ratio;
      } else {
        w = h * ratio;
      }
      // Re-anchor on the corner opposite the one being dragged.
      x = dir.includes('l') ? start.x + start.width - w : start.x;
      y = dir.includes('t') ? start.y + start.height - h : start.y;
      width = w;
      height = h;
    }

    if (opts.fromCenter) {
      // Overrides the edge anchoring above: the start centre is what stays put.
      x = start.x + start.width / 2 - width / 2;
      y = start.y + start.height / 2 - height / 2;
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

  /** Parses a `data-connect` attribute into a validated {@link EdgeSide}, or null when absent/invalid. */
  private parseSide(raw: string | null): EdgeSide | null {
    return raw === 'N' || raw === 'E' || raw === 'S' || raw === 'W' ? raw : null;
  }

  /**
   * ITEM B — while dragging a connector, shows the anchor pastilles of the card under the cursor and
   * highlights the one the connector will *actually* attach to. That anchor is the routing-resolved
   * side of the target facing the source card's centre ({@link edgeAnchor}), the same computation
   * {@link ConnectionLineComponent} uses for the connector's end anchor — NOT the pastille nearest
   * the cursor, which the previous behaviour highlighted (misleading: the line rarely lands there).
   * The surface owns the pointer capture, so `event.target` is always the surface; the real hovered
   * card is resolved via `document.elementFromPoint` (parity with {@link finishConnect}).
   */
  private updateConnectHover(event: PointerEvent, fromId: string): void {
    const dropEl = document.elementFromPoint(event.clientX, event.clientY);
    const cardEl = dropEl instanceof Element ? dropEl.closest<HTMLElement>('[data-card-id]') : null;
    const targetId = cardEl?.getAttribute('data-card-id') ?? null;
    if (!targetId || targetId === fromId) {
      this.hoverAnchors.set(null);
      return;
    }
    const card = this.store.cards().find((c) => c.id === targetId);
    const from = this.store.cards().find((c) => c.id === fromId);
    if (!card || !from) {
      this.hoverAnchors.set(null);
      return;
    }
    const rect = cardRect(card);
    const points = CARDINAL_SIDES.map((side) => ({ side, ...edgeAnchorPoint(rect, side) }));
    // Same anchor the connector routes to: the target's edge facing the source card's centre.
    const attach = edgeAnchor(rect, cardRect(from)).side;
    this.hoverAnchors.set({ cardId: targetId, points, attach });
  }

  private updateConnectGhost(g: Extract<Gesture, { kind: 'connect' }>, x: number, y: number): void {
    const from = this.store.cards().find((c) => c.id === g.fromId);
    if (!from) {
      return;
    }
    const rect = cardRect(from);
    // Start from the grabbed handle's edge midpoint when known, else the card centre.
    const start = g.fromSide ? edgeAnchorPoint(rect, g.fromSide) : { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    // End snaps to the highlighted anchor of the hovered target, else follows the raw cursor.
    const hover = this.hoverAnchors();
    const target = hover ? this.store.cards().find((c) => c.id === hover.cardId) : undefined;
    const end = hover && target ? edgeAnchorPoint(cardRect(target), hover.attach) : { x, y };
    this.connectGhost.set({ from: start, to: end });
  }

  private finishConnect(event: PointerEvent): void {
    this.connectGhost.set(null);
    this.hoverAnchors.set(null);
    const g = this.gesture;
    if (g.kind !== 'connect') {
      return;
    }
    // The surface holds the pointer capture for the whole gesture, so `event.target` resolves to
    // the surface — never the card under the pointer. Hit-test the real drop point instead (parity
    // with PouetPouet's `document.elementFromPoint` in `board-canvas.tsx`) so the target card is
    // detected and the connector is actually created (BUG 6).
    const dropEl = document.elementFromPoint(event.clientX, event.clientY);
    const target = dropEl instanceof Element ? dropEl.closest<HTMLElement>('[data-card-id]') : null;
    const toId = target?.getAttribute('data-card-id') ?? null;
    if (toId && toId !== g.fromId) {
      // The style is chosen before the connector is drawn, like a card's colour — so it must be
      // carried by the creation itself, not patched in once the connector already exists.
      this.store.addConnection(g.fromId, toId, {
        startCap: this.connectorStartCap(),
        endCap: this.connectorEndCap(),
        lineStyle: this.connectorLineStyle(),
      });
    }
  }

  /**
   * Writes back a line's diagonal if the gesture turned it over. Once, on release — the box itself
   * is what moved during the drag; this is the one bit the box cannot carry.
   */
  private commitLineDiag(g: Extract<Gesture, { kind: 'resize-card' }>): void {
    if (!g.lineDiag || !g.lineContent) {
      return;
    }
    const spec = parseShape(g.lineContent);
    if (spec.diag === g.lineDiag) {
      return;
    }
    // `lineContent` is the pre-gesture value: the card itself already holds the previewed one, so
    // it is passed explicitly as the undo target.
    this.store.updateCard(g.id, serializeShape({ ...spec, diag: g.lineDiag }), g.lineContent);
  }

  /**
   * Snaps the drag end-point to the nearest multiple of {@link LINE_SNAP_DEG}, keeping the gesture's
   * length — Shift while drawing a line, the Figma/Miro convention. Snapping the *angle* rather
   * than the axes is what makes 15°, 30° or 45° reachable, not just horizontal/vertical.
   */
  private snapAngle(startX: number, startY: number, x: number, y: number): { x: number; y: number } {
    const dx = x - startX;
    const dy = y - startY;
    const step = (LINE_SNAP_DEG * Math.PI) / 180;
    const angle = Math.round(Math.atan2(dy, dx) / step) * step;
    const length = Math.hypot(dx, dy);
    return { x: startX + Math.cos(angle) * length, y: startY + Math.sin(angle) * length };
  }

  /**
   * Commits a dragged line as a SHAPE card: the box is the drag's bounding box, and `diag` records
   * which of its diagonals the pointer travelled — together they reproduce the exact segment drawn.
   *
   * A drag too short to be a deliberate line (a plain click, or a slip of the pointer) commits
   * nothing: it would leave a degenerate, near-invisible card the user cannot grab to delete.
   */
  private finishLine(g: Extract<Gesture, { kind: 'draw-line' }>): void {
    const dx = g.x - g.startX;
    const dy = g.y - g.startY;
    if (Math.hypot(dx, dy) < LINE_MIN_DRAG) {
      return;
    }
    // Both diagonals of a box are covered by these two cases: the pointer either kept the sign of
    // dx and dy together (top-left→bottom-right) or crossed them (bottom-left→top-right).
    const diag = dx * dy >= 0 ? 'tlbr' : 'bltr';
    const content = serializeShape({
      kind: 'line',
      stroke: this.color(),
      fill: null,
      opacity: 1,
      rotation: 0,
      diag,
    });
    this.store.addCard(
      Math.min(g.startX, g.x),
      Math.min(g.startY, g.y),
      'SHAPE',
      content,
      this.color(),
      // A perfectly horizontal or vertical line (Shift snap) is flat on one axis: its box would be
      // 0px on that side and the card would render nothing at all. The floor keeps the box alive
      // without moving the line — 1px is below what the 2px stroke already covers.
      Math.max(LINE_MIN, Math.abs(dx)),
      Math.max(LINE_MIN, Math.abs(dy)),
    );
    this.toolConsumed.emit();
  }

  /**
   * Builds the SVG `d` attribute for a freehand stroke. `offsetX`/`offsetY` shift the points into a
   * local coordinate space (the DRAW card's top-left corner in {@link finishDraw}); left at 0 the
   * path stays in absolute canvas coordinates, as the live {@link drawPreview} overlay needs.
   */
  private drawPath(points: [number, number][], offsetX = 0, offsetY = 0): string {
    return points.map((p, i) => `${i === 0 ? 'M' : 'L'}${(p[0] - offsetX).toFixed(1)},${(p[1] - offsetY).toFixed(1)}`).join(' ');
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
    const d = this.drawPath(points, minX, minY);
    this.store.addCard(minX, minY, 'DRAW', d, this.color(), width, height);
    // The free-draw tool stays active after a stroke so the user can keep drawing without
    // re-selecting it; unlike placement tools it deliberately does NOT emit `toolConsumed`.
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
  private placementKind(tool: ToolMode): 'sticky' | 'text' | 'table' | 'shape' | 'frame' | null {
    if (tool === 'sticky' || tool === 'text' || tool === 'table' || tool === 'frame') {
      return tool;
    }
    if (SHAPE_TOOLS[tool]) {
      return 'shape';
    }
    return null;
  }

  /**
   * Colour for a newly created card: the colour the user actively picked when there is one,
   * otherwise the card type's own default. Keeps a fresh post-it soft yellow on an untouched
   * board while honouring an explicit pick (recette finding — the pick was previously ignored by
   * every type except SHAPE/DRAW).
   */
  private newCardColor(typeDefault: string): string {
    return this.colorPicked() ? this.color() : typeDefault;
  }

  private createCard(kind: 'sticky' | 'text' | 'table' | 'shape', x: number, y: number): void {
    const px = x - DEFAULT_CARD_W / 2;
    const py = y - DEFAULT_CARD_H / 2;
    if (kind === 'sticky') {
      this.store.addCard(px, py, 'TEXT', '', this.newCardColor(DEFAULT_CARD_COLOR), DEFAULT_CARD_W, DEFAULT_CARD_H);
    } else if (kind === 'text') {
      // 'text' is the LABEL placement tool (US08.6.2) — a compact, persistent text label
      // distinct from the 'sticky' post-it (TEXT). Server-side defaults are unchanged
      // (192×128, #FFEB3B, EN08.4); only the client renders it without a post-it background
      // (see BoardCardComponent's `type === 'LABEL'` case).
      this.store.addCard(px, py, 'LABEL', '', this.newCardColor(DEFAULT_CARD_COLOR), DEFAULT_CARD_W, DEFAULT_CARD_H);
    } else if (kind === 'table') {
      this.store.addCard(
        px,
        py,
        'TABLE',
        serializeTable([['', '', ''], ['', '', ''], ['', '', '']]),
        this.newCardColor('#FFFFFF'),
        240,
        140,
      );
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

  /**
   * BUG A — track cards by their stable {@link Card.key} (the `clientTag`) when present, falling
   * back to `id`. A card created optimistically keeps the same key when its `id` is swapped from
   * the temporary clientTag to the server uuid on `card:created`, so `@for` reconciles the
   * board-card in place instead of destroying and re-mounting it mid-edit (which lost the typed,
   * uncommitted text). Server-originated cards have no key and use their already-stable id.
   */
  protected trackCard = (_: number, c: Card): string => c.key ?? c.id;

  // ── Card event relays ─────────────────────────────────────────────────────
  protected onCardContent(card: Card, content: string): void {
    this.store.updateCard(card.id, content);
  }
  /**
   * Auto-grow (ITEM I): a TEXT/LABEL card whose committed text no longer fits its stored height asks
   * to be grown. Persist it through the existing `card:resize` contract — width is kept, only the
   * height grows — so the taller card survives display mode and a reload (PouetPouet parity).
   */
  protected onCardHeightGrow(card: Card, height: number): void {
    this.store.resizeCard(card.id, card.width, height);
  }
  protected onCardEditing(card: Card, editing: boolean): void {
    // BUG F — auto-edit is one-shot: the moment a card actually enters inline edit, consume the
    // `autoEditCardId` flag. Otherwise it stays pinned to the last-created card, which then
    // "monopolises" edit mode (it re-opens on every re-render/re-mount and blocks other cards
    // from taking over). Only the enter transition consumes it — leaving edit must not.
    if (editing) {
      this.store.consumeAutoEdit(card.id);
    }
    this.store.notifyEditing(card.id, editing);
  }
  protected onFrameTitle(id: string, title: string): void {
    this.store.updateFrame(id, title);
  }
  protected onFrameActive(id: string, active: boolean): void {
    this.store.setFrameActive(id, active);
  }
  /** US08.9.3 — lift the frame above every other item (its `layer` becomes one past the highest). */
  protected onFrameBringToFront(id: string): void {
    this.store.setFrameLayer(id, this.store.frontLayer());
  }
  /** US08.9.3 — drop the frame beneath every other item (its `layer` becomes one below the lowest). */
  protected onFrameSendToBack(id: string): void {
    this.store.setFrameLayer(id, this.store.backLayer());
  }

  /** US08.8.1 — delete the frame from its header button; the cards it contains are kept. */
  protected onFrameRemove(id: string): void {
    this.store.deleteFrame(id);
  }
  protected onConnectionSelect(id: string): void {
    this.store.selectCards(new Set([id]));
  }
}
