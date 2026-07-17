import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import type { ConnAnchor, ConnCap, ConnLineStyle, Connection, ConnShape } from '../model/board.types';
import { type EdgeSide, type Rect, edgeAnchor, edgeAnchorPoint } from '../model/board-geometry';

/** Neutral gray applied when {@link Connection.color} is null. */
const DEFAULT_COLOR = '#9ca3af';
/** Accent color used for the line, arrowheads and label border when selected. */
const SELECTED_COLOR = '#6366f1';
/** Fallback stroke width when {@link Connection.width} is falsy. */
const DEFAULT_WIDTH = 2;

/** i18n key per {@link ConnShape}, feeding the descriptive `aria-label` (US08.7.2 A11y AC). */
const SHAPE_KEYS: Record<ConnShape, string> = {
  straight: 'whiteboard.connector.style.shape.straight',
  curved: 'whiteboard.connector.style.shape.curved',
  orthogonal: 'whiteboard.connector.style.shape.orthogonal',
};

/** i18n key per {@link ConnLineStyle}, feeding the descriptive `aria-label` (US08.7.2 A11y AC). */
const LINE_STYLE_KEYS: Record<ConnLineStyle, string> = {
  solid: 'whiteboard.connection.ariaLabel.solid',
  dashed: 'whiteboard.connection.ariaLabel.dashed',
  dotted: 'whiteboard.connection.ariaLabel.dotted',
};

/** i18n key per {@link ConnCap}, used to spell out each endpoint marker in the `aria-label`. */
const CAP_KEYS: Record<ConnCap, string> = {
  none: 'whiteboard.connector.style.cap.none',
  arrow: 'whiteboard.connector.style.cap.arrow',
  triangle: 'whiteboard.connector.style.cap.triangle',
  circle: 'whiteboard.connector.style.cap.circle',
  diamond: 'whiteboard.connector.style.cap.diamond',
};

/** A rendered endpoint cap: either an SVG polygon (arrow/triangle/diamond) or a circle. */
type CapMarker = { kind: 'polygon'; points: string } | { kind: 'circle'; cx: number; cy: number; r: number };

/** A 2D point in board (canvas) coordinates. */
interface Point {
  x: number;
  y: number;
}

/** Outward unit normal for each rectangle edge side (points away from the card). */
const EDGE_NORMAL: Record<EdgeSide, Point> = {
  N: { x: 0, y: -1 },
  S: { x: 0, y: 1 },
  E: { x: 1, y: 0 },
  W: { x: -1, y: 0 },
};

/** The routed geometry of a connection: its SVG path plus end tangents and label anchor. */
interface RoutedPath {
  /** SVG `d` attribute for the visible line and hit-area. */
  d: string;
  /** Resolved start anchor point (on the `from` card edge). */
  a: Point;
  /** Resolved end anchor point (on the `to` card edge). */
  b: Point;
  /** Unit tangent at the start anchor, pointing into the `from` card. */
  tStart: Point;
  /** Unit tangent at the end anchor, pointing into the `to` card. */
  tEnd: Point;
  /** Point where the label is centered. */
  mid: Point;
}

/**
 * Builds the routed path between two anchor points according to the connection shape.
 * Curves and elbows leave each anchor perpendicular to its edge side, mirroring the
 * PouetPouet reference (`connection-line.tsx`).
 */
function buildPath(shape: ConnShape, a: Point, sa: EdgeSide, b: Point, sb: EdgeSide): RoutedPath {
  const oa = EDGE_NORMAL[sa];
  const ob = EDGE_NORMAL[sb];
  // Arrowheads point into the card at each end (opposite the outward side normal).
  const tStart: Point = { x: -oa.x, y: -oa.y };
  const tEnd: Point = { x: -ob.x, y: -ob.y };
  const mid: Point = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };

  if (shape === 'straight') {
    return { d: `M${a.x},${a.y} L${b.x},${b.y}`, a, b, tStart, tEnd, mid };
  }

  if (shape === 'orthogonal') {
    const stub = 24;
    const a1: Point = { x: a.x + oa.x * stub, y: a.y + oa.y * stub };
    const b1: Point = { x: b.x + ob.x * stub, y: b.y + ob.y * stub };
    const horizA = sa === 'E' || sa === 'W';
    const corner: Point = horizA ? { x: b1.x, y: a1.y } : { x: a1.x, y: b1.y };
    return {
      d: `M${a.x},${a.y} L${a1.x},${a1.y} L${corner.x},${corner.y} L${b1.x},${b1.y} L${b.x},${b.y}`,
      a,
      b,
      tStart,
      tEnd,
      mid: corner,
    };
  }

  // curved (default)
  const dist = Math.max(40, Math.hypot(b.x - a.x, b.y - a.y) * 0.4);
  const c1: Point = { x: a.x + oa.x * dist, y: a.y + oa.y * dist };
  const c2: Point = { x: b.x + ob.x * dist, y: b.y + ob.y * dist };
  return { d: `M${a.x},${a.y} C${c1.x},${c1.y} ${c2.x},${c2.y} ${b.x},${b.y}`, a, b, tStart, tEnd, mid };
}

/**
 * Resolves the endpoint anchor for `self` (facing `other`): honours an explicit pinned
 * {@link ConnAnchor} `override` when present, otherwise falls back to the side of `self` facing
 * `other`'s centre ({@link edgeAnchor}). Keeps the `{ x, y, side }` shape consumed by {@link buildPath}.
 */
function resolveAnchor(
  self: Rect,
  other: Rect,
  override: ConnAnchor | null | undefined,
): { x: number; y: number; side: EdgeSide } {
  if (override) {
    return { ...edgeAnchorPoint(self, override), side: override };
  }
  return edgeAnchor(self, other);
}

/**
 * SVG polygon points for an arrowhead whose tip sits at `tip` and body extends
 * back along `dir` (a unit tangent) for `size` units.
 */
function arrowPolygon(tip: Point, dir: Point, size: number): string {
  const baseCenter: Point = { x: tip.x - dir.x * size, y: tip.y - dir.y * size };
  const perp: Point = { x: -dir.y, y: dir.x };
  const half = size / 2;
  const p1: Point = { x: baseCenter.x + perp.x * half, y: baseCenter.y + perp.y * half };
  const p2: Point = { x: baseCenter.x - perp.x * half, y: baseCenter.y - perp.y * half };
  return `${tip.x},${tip.y} ${p1.x},${p1.y} ${p2.x},${p2.y}`;
}

/**
 * Filled triangle marker — like {@link arrowPolygon} but with a wider base, so it reads as a
 * solid "triangle" cap distinct from the slimmer "arrow". Tip at `tip`, oriented along `dir`.
 */
function trianglePolygon(tip: Point, dir: Point, size: number): string {
  const baseCenter: Point = { x: tip.x - dir.x * size, y: tip.y - dir.y * size };
  const perp: Point = { x: -dir.y, y: dir.x };
  const half = size * 0.72;
  const p1: Point = { x: baseCenter.x + perp.x * half, y: baseCenter.y + perp.y * half };
  const p2: Point = { x: baseCenter.x - perp.x * half, y: baseCenter.y - perp.y * half };
  return `${tip.x},${tip.y} ${p1.x},${p1.y} ${p2.x},${p2.y}`;
}

/**
 * Diamond (rhombus) marker centred just inside the tip, oriented along `dir`: forward vertex at
 * `tip`, back vertex `size` behind it, and two side vertices at the midpoint offset by `size/2`.
 */
function diamondPolygon(tip: Point, dir: Point, size: number): string {
  const perp: Point = { x: -dir.y, y: dir.x };
  const back: Point = { x: tip.x - dir.x * size, y: tip.y - dir.y * size };
  const mid: Point = { x: tip.x - dir.x * (size / 2), y: tip.y - dir.y * (size / 2) };
  const half = size / 2;
  const left: Point = { x: mid.x + perp.x * half, y: mid.y + perp.y * half };
  const right: Point = { x: mid.x - perp.x * half, y: mid.y - perp.y * half };
  return `${tip.x},${tip.y} ${left.x},${left.y} ${back.x},${back.y} ${right.x},${right.y}`;
}

/**
 * Resolves the {@link CapMarker} rendered for a given {@link ConnCap} at endpoint `tip`, oriented
 * along the end tangent `dir`. `none` yields null (no marker). Arrow/triangle/diamond are filled
 * polygons oriented along the tangent; circle is a dot centred on the endpoint.
 */
function capMarker(cap: ConnCap, tip: Point, dir: Point, size: number): CapMarker | null {
  switch (cap) {
    case 'none':
      return null;
    case 'arrow':
      return { kind: 'polygon', points: arrowPolygon(tip, dir, size) };
    case 'triangle':
      return { kind: 'polygon', points: trianglePolygon(tip, dir, size) };
    case 'diamond':
      return { kind: 'polygon', points: diamondPolygon(tip, dir, size) };
    case 'circle':
      return { kind: 'circle', cx: tip.x, cy: tip.y, r: size / 2 };
  }
}

/**
 * Renders a single connection (line/arrow) between two cards inside the shared whiteboard
 * SVG layer. The host is the `<g wbConnectionLine>` group created by the parent canvas, so
 * every rendered element is namespaced with the `svg:` prefix to compose into that SVG.
 *
 * The component is intentionally pure: it derives all geometry from its three rect/connection
 * inputs via {@link computed} signals and emits {@link select} on interaction — it has no
 * dependency on `BoardStore` or any transport, mirroring the transport-agnostic design of
 * {@link WhiteboardCanvasComponent}.
 */
@Component({
  selector: '[wbConnectionLine]',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslocoPipe],
  templateUrl: './connection-line.component.html',
  styleUrl: './connection-line.component.scss',
})
export class ConnectionLineComponent {
  private readonly transloco = inject(TranslocoService);

  /** The connection to render (shape, arrow, color, width, dashed, label). */
  readonly connection = input.required<Connection>();
  /** Bounding rect of the source card, in board coordinates. */
  readonly fromRect = input.required<Rect>();
  /** Bounding rect of the target card, in board coordinates. */
  readonly toRect = input.required<Rect>();
  /** Whether this connection is currently selected (draws a highlight halo). */
  readonly selected = input<boolean>(false);
  /** Read-only board: the label cannot be edited. The component did not know about it until now —
   *  nothing it offered was editable. */
  readonly readOnly = input<boolean>(false);
  /** Short display name of the source card, used to compose the descriptive {@link ariaLabel}. */
  readonly fromLabel = input<string>('');
  /** Short display name of the target card, used to compose the descriptive {@link ariaLabel}. */
  readonly toLabel = input<string>('');

  /** Emits the connection id when the hit-area is clicked or activated by keyboard. */
  readonly select = output<string>();
  /** Emits the label committed inline — `null` clears it. */
  readonly labelCommit = output<string | null>();

  /** The two edge anchors and the routed path derived from the current rects/shape. */
  private readonly routed = computed<RoutedPath>(() => {
    const conn = this.connection();
    const from = this.fromRect();
    const to = this.toRect();
    const a = resolveAnchor(from, to, conn.fromAnchor);
    const b = resolveAnchor(to, from, conn.toAnchor);
    return buildPath(conn.shape, a, a.side, b, b.side);
  });

  /** SVG `d` attribute shared by the halo, hit-area and visible line. */
  protected readonly pathD = computed<string>(() => this.routed().d);

  /** Effective stroke color: accent when selected, else the connection color (or gray). */
  protected readonly strokeColor = computed<string>(() =>
    this.selected() ? SELECTED_COLOR : this.connection().color || DEFAULT_COLOR,
  );

  /** Effective stroke width, never below the {@link DEFAULT_WIDTH} fallback. */
  protected readonly strokeWidth = computed<number>(() => this.connection().width || DEFAULT_WIDTH);

  /** Wide transparent hit stroke width (captures pointer/keyboard interaction). */
  protected readonly hitWidth = computed<number>(() => Math.max(16, this.strokeWidth() + 12));

  /** Line cap: butt when a marker is present at either end so no round cap bleeds past it. */
  protected readonly lineCap = computed<'butt' | 'round'>(() => {
    const conn = this.connection();
    return conn.startCap === 'none' && conn.endCap === 'none' ? 'round' : 'butt';
  });

  /**
   * `stroke-dasharray` derived from {@link Connection.lineStyle} (US08.7.2 extended):
   * `solid` → null (continuous), `dashed` → long dashes ≈ "6 4", `dotted` → fine dots ≈ "2 4",
   * both scaled with the stroke width so the pattern stays proportional at any thickness.
   */
  protected readonly dashArray = computed<string | null>(() => {
    const w = this.strokeWidth();
    switch (this.connection().lineStyle) {
      case 'solid':
        return null;
      case 'dashed':
        return `${Math.max(6, w * 3)} ${Math.max(4, w * 2)}`;
      case 'dotted':
        return `${Math.max(2, w)} ${Math.max(4, w * 2)}`;
    }
  });

  /** Halo stroke width shown behind the line while selected. */
  protected readonly haloWidth = computed<number>(() => this.strokeWidth() + 8);

  /** Endpoint marker at the `to` anchor for {@link Connection.endCap}, or null when `none`. */
  protected readonly endCap = computed<CapMarker | null>(() => {
    const routed = this.routed();
    return capMarker(this.connection().endCap, routed.b, routed.tEnd, this.headSize());
  });

  /** Endpoint marker at the `from` anchor for {@link Connection.startCap}, or null when `none`. */
  protected readonly startCap = computed<CapMarker | null>(() => {
    const routed = this.routed();
    return capMarker(this.connection().startCap, routed.a, routed.tStart, this.headSize());
  });

  /** Label text (null when the connection has no label). */
  protected readonly label = computed<string | null>(() => this.connection().label);
  /** Whether the label is being edited inline (double-click on the line or its label). */
  protected readonly editing = signal(false);
  private readonly labelInput = viewChild<ElementRef<HTMLInputElement>>('labelInput');
  private readonly injector = inject(Injector);

  /** Geometry of the label background box, centered on the path midpoint. */
  protected readonly labelBox = computed(() => {
    const text = this.connection().label ?? '';
    const mid = this.routed().mid;
    return {
      x: mid.x - text.length * 3.6 - 6,
      y: mid.y - 10,
      width: text.length * 7.2 + 12,
      height: 20,
    };
  });

  /** Point where the label text baseline is anchored. */
  protected readonly labelTextPos = computed<Point>(() => {
    const mid = this.routed().mid;
    return { x: mid.x, y: mid.y + 4 };
  });

  /** Arrowhead size, scaled with stroke width (mirrors the reference). */
  private readonly headSize = computed<number>(() => 7 + this.strokeWidth() * 1.5);

  /**
   * Descriptive `aria-label` for the focusable hit-area (US08.7.2 A11y AC) — states the
   * connector's shape, its line style (solid/dashed/dotted), its direction and its endpoint
   * markers (e.g. "Connecteur courbe en pointillés de Idée 1 vers Idée 2 (départ : flèche,
   * arrivée : losange)"), so a screen-reader user can tell connectors apart without relying on
   * colour/shape alone. Falls back to a generic placeholder for either endpoint when
   * {@link fromLabel}/{@link toLabel} is empty (endpoint card with no readable text, e.g. an
   * IMAGE/DRAW/SHAPE card — see `StructuredCanvasComponent`). The cap suffix is omitted entirely
   * when both ends are `none`.
   */
  protected readonly ariaLabel = computed<string>(() => {
    const conn = this.connection();
    const shape = this.transloco.translate(SHAPE_KEYS[conn.shape]);
    const from = this.fromLabel() || this.transloco.translate('whiteboard.connection.untitledCard');
    const to = this.toLabel() || this.transloco.translate('whiteboard.connection.untitledCard');
    const base = this.transloco.translate(LINE_STYLE_KEYS[conn.lineStyle], { shape, from, to });
    if (conn.startCap === 'none' && conn.endCap === 'none') {
      return base;
    }
    const start = this.transloco.translate(CAP_KEYS[conn.startCap]);
    const end = this.transloco.translate(CAP_KEYS[conn.endCap]);
    return base + this.transloco.translate('whiteboard.connection.ariaLabel.caps', { start, end });
  });

  /** Emits {@link select} with the connection id. */
  /** Opens the label editor — mirrors `BoardCardComponent.startEdit`, the board's own precedent. */
  onLabelEdit(): void {
    if (this.readOnly()) {
      return;
    }
    this.editing.set(true);
    // Focus once the input exists — same `queueMicrotask` as the card editor. Without it the input
    // shows but the focus stays on the document, so `Suppr` reaches the board's own handler and
    // deletes the whole connector instead of typing in the field (recette 2026-07-17).
    // `afterNextRender`, not `queueMicrotask`: the field is created by `@if (editing())`, so it
    // does not exist until Angular has rendered — a microtask runs before that and found nothing to
    // focus. Measured: the input showed, the focus stayed on the document, and `Suppr` reached the
    // board's handler and deleted the whole connector (recette 2026-07-17).
    afterNextRender(
      () => {
        const el = this.labelInput()?.nativeElement;
        if (!el) {
          return;
        }
        // Seeded here rather than through a binding — see the template.
        el.value = this.connection().label ?? '';
        el.focus();
        // Select the existing label: typing replaces it, which is what a double-click implies.
        el.select();
      },
      { injector: this.injector },
    );
  }

  protected onLabelDblClick(event: Event): void {
    event.stopPropagation();
    this.onLabelEdit();
  }

  /**
   * A blank field clears the label: emits an explicit `null`, distinct from the field simply not
   * being touched (US08.7.2 AC3 — `undefined` vs `null`).
   */
  protected commitLabel(): void {
    if (!this.editing()) {
      return;
    }
    const value = (this.labelInput()?.nativeElement.value ?? '').trim();
    this.editing.set(false);
    this.labelCommit.emit(value === '' ? null : value);
  }

  protected cancelLabel(event: Event): void {
    event.stopPropagation();
    this.editing.set(false);
  }

  protected onSelect(event: Event): void {
    event.stopPropagation();
    this.select.emit(this.connection().id);
  }
}
