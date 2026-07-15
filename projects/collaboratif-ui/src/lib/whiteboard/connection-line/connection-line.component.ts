import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { TranslocoService } from '@jsverse/transloco';
import type { Connection, ConnShape } from '../model/board.types';
import { type EdgeSide, type Rect, edgeAnchor } from '../model/board-geometry';

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
    return { d: `M${a.x},${a.y} L${b.x},${b.y}`, tStart, tEnd, mid };
  }

  if (shape === 'orthogonal') {
    const stub = 24;
    const a1: Point = { x: a.x + oa.x * stub, y: a.y + oa.y * stub };
    const b1: Point = { x: b.x + ob.x * stub, y: b.y + ob.y * stub };
    const horizA = sa === 'E' || sa === 'W';
    const corner: Point = horizA ? { x: b1.x, y: a1.y } : { x: a1.x, y: b1.y };
    return {
      d: `M${a.x},${a.y} L${a1.x},${a1.y} L${corner.x},${corner.y} L${b1.x},${b1.y} L${b.x},${b.y}`,
      tStart,
      tEnd,
      mid: corner,
    };
  }

  // curved (default)
  const dist = Math.max(40, Math.hypot(b.x - a.x, b.y - a.y) * 0.4);
  const c1: Point = { x: a.x + oa.x * dist, y: a.y + oa.y * dist };
  const c2: Point = { x: b.x + ob.x * dist, y: b.y + ob.y * dist };
  return { d: `M${a.x},${a.y} C${c1.x},${c1.y} ${c2.x},${c2.y} ${b.x},${b.y}`, tStart, tEnd, mid };
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
  /** Short display name of the source card, used to compose the descriptive {@link ariaLabel}. */
  readonly fromLabel = input<string>('');
  /** Short display name of the target card, used to compose the descriptive {@link ariaLabel}. */
  readonly toLabel = input<string>('');

  /** Emits the connection id when the hit-area is clicked or activated by keyboard. */
  readonly select = output<string>();

  /** The two edge anchors and the routed path derived from the current rects/shape. */
  private readonly routed = computed<RoutedPath>(() => {
    const from = this.fromRect();
    const to = this.toRect();
    const a = edgeAnchor(from, to);
    const b = edgeAnchor(to, from);
    return buildPath(this.connection().shape, a, a.side, b, b.side);
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

  /** Line cap: butt when arrows are present so no round cap bleeds past an arrow tip. */
  protected readonly lineCap = computed<'butt' | 'round'>(() => {
    const arrow = this.connection().arrow;
    return arrow === 'none' ? 'round' : 'butt';
  });

  /** `stroke-dasharray` when the connection is dashed, otherwise null (solid). */
  protected readonly dashArray = computed<string | null>(() => {
    if (!this.connection().dashed) {
      return null;
    }
    const w = this.strokeWidth();
    return `${Math.max(6, w * 3)} ${Math.max(4, w * 2)}`;
  });

  /** Halo stroke width shown behind the line while selected. */
  protected readonly haloWidth = computed<number>(() => this.strokeWidth() + 8);

  /** Arrowhead polygon at the end anchor, or null when there is no end arrow. */
  protected readonly endArrow = computed<string | null>(() => {
    const arrow = this.connection().arrow;
    if (arrow !== 'end' && arrow !== 'both') {
      return null;
    }
    const routed = this.routed();
    const b = edgeAnchor(this.toRect(), this.fromRect());
    return arrowPolygon(b, routed.tEnd, this.headSize());
  });

  /** Arrowhead polygon at the start anchor, or null when there is no start arrow. */
  protected readonly startArrow = computed<string | null>(() => {
    const arrow = this.connection().arrow;
    if (arrow !== 'start' && arrow !== 'both') {
      return null;
    }
    const routed = this.routed();
    const a = edgeAnchor(this.fromRect(), this.toRect());
    return arrowPolygon(a, routed.tStart, this.headSize());
  });

  /** Label text (null when the connection has no label). */
  protected readonly label = computed<string | null>(() => this.connection().label);

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
   * connector's shape, whether it is dashed, and its direction (e.g. "Connecteur courbe en
   * pointillés, de Idée 1 vers Idée 2"), so a screen-reader user can tell connectors apart
   * without relying on colour/shape alone. Falls back to a generic placeholder for either
   * endpoint when {@link fromLabel}/{@link toLabel} is empty (endpoint card with no readable
   * text, e.g. an IMAGE/DRAW/SHAPE card — see `StructuredCanvasComponent`).
   */
  protected readonly ariaLabel = computed<string>(() => {
    const conn = this.connection();
    const shape = this.transloco.translate(SHAPE_KEYS[conn.shape]);
    const from = this.fromLabel() || this.transloco.translate('whiteboard.connection.untitledCard');
    const to = this.toLabel() || this.transloco.translate('whiteboard.connection.untitledCard');
    const key = conn.dashed ? 'whiteboard.connection.ariaLabel.dashed' : 'whiteboard.connection.ariaLabel.solid';
    return this.transloco.translate(key, { shape, from, to });
  });

  /** Emits {@link select} with the connection id. */
  protected onSelect(event: Event): void {
    event.stopPropagation();
    this.select.emit(this.connection().id);
  }
}
