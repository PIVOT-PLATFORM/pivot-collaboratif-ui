import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  HostListener,
  inject,
  input,
  OnDestroy,
  output,
  signal,
  ViewChild,
} from '@angular/core';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import {
  AlignGuide,
  BoundingBox,
  CanvasObject,
  CanvasTool,
  COLOR_PALETTE,
  DUPLICATE_OFFSET,
  HANDLE_SIZE,
  HandlePosition,
  HEX_REGEX,
  MAX_TEXT_LENGTH,
  SNAP_TOLERANCE,
  ShapeObject,
  StrokeObject,
  TextObject,
} from './model/canvas.model';
import {
  clampObjectToCanvas,
  getBoundingBox,
  hitTest,
  pointInBBox,
  resizeAnchor,
  resizeBBox,
  scaleObject,
  translateObject,
} from './model/canvas-geometry';
import { UndoRedoService } from '../../core/whiteboard/undo-redo.service';

/** A canvas DRAW action emitted so WhiteboardSyncService (US08.3.2b) can publish to STOMP. */
export interface DrawAction {
  type: 'DRAW';
  subType: 'stroke' | 'shape' | 'erase' | 'move' | 'resize' | 'text';
  payload: unknown;
}

/** Applies a DRAW action received from another participant (called by WhiteboardSyncService). */
export type ApplyRemoteAction = (action: DrawAction) => void;

/** Emitted after a successful local undo so WhiteboardBoardComponent can relay `UNDO` over STOMP. */
export interface UndoEvent {
  eventId: string;
}

@Component({
  selector: 'app-whiteboard-canvas',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslocoPipe],
  templateUrl: './whiteboard-canvas.component.html',
  styleUrl: './whiteboard-canvas.component.scss',
})
export class WhiteboardCanvasComponent implements AfterViewInit, OnDestroy {
  @ViewChild('mainCanvas') private canvasRef!: ElementRef<HTMLCanvasElement>;
  @ViewChild('minimapCanvas') private minimapRef!: ElementRef<HTMLCanvasElement>;
  @ViewChild('textInput') private textInputRef!: ElementRef<HTMLTextAreaElement>;
  @ViewChild('dialogContainer') private dialogRef?: ElementRef<HTMLDivElement>;

  /** Board title — shown in aria-label and page title. */
  readonly boardTitle = input<string>('');
  /** Read-only mode — set by WhiteboardSyncService when WS is disconnected (US08.3.2b). */
  readonly readOnly = input<boolean>(false);

  /** Emits a DRAW action for STOMP publication (consumed by WhiteboardSyncService). */
  readonly drawAction = output<DrawAction>();
  /**
   * Emits once per successful local undo, carrying the id of the undone action
   * (US08.3.3 AC5). `WhiteboardBoardComponent` relays it as `UNDO { eventId }` via
   * `WhiteboardSyncService.publish`. Never emitted for redo — the wire contract only
   * defines `UNDO`.
   */
  readonly undoAction = output<UndoEvent>();

  // ─── Injected services ───────────────────────────────────────────────────
  private readonly undoRedo = inject(UndoRedoService);
  private readonly transloco = inject(TranslocoService);

  // ─── Canvas state ────────────────────────────────────────────────────────
  protected readonly objects = signal<CanvasObject[]>([]);
  protected readonly selectedIds = signal<Set<string>>(new Set());
  protected readonly activeTool = signal<CanvasTool>('select');
  protected readonly strokeColor = signal<string>('#1a1a2e');
  protected readonly fillColor = signal<string>('transparent');
  protected readonly lineWidth = signal<number>(2);
  protected readonly zoom = signal<number>(1);
  protected readonly panX = signal<number>(0);
  protected readonly panY = signal<number>(0);
  protected readonly showMinimap = signal<boolean>(true);
  protected readonly showShortcutDialog = signal<boolean>(false);
  protected readonly showColorPicker = signal<boolean>(false);
  protected readonly customHexInput = signal<string>('');
  protected readonly customHexError = signal<boolean>(false);
  protected readonly isEditingText = signal<boolean>(false);
  protected readonly textEditX = signal<number>(0);
  protected readonly textEditY = signal<number>(0);
  protected readonly editingObjectId = signal<string | null>(null);

  // ─── Computed ────────────────────────────────────────────────────────────
  protected readonly palette = COLOR_PALETTE;
  protected readonly canUndo = this.undoRedo.canUndo;
  protected readonly canRedo = this.undoRedo.canRedo;
  protected readonly selectionCount = computed(() => this.selectedIds().size);
  protected readonly canGroup = computed(() => this.selectedIds().size >= 2);
  protected readonly hasSelection = computed(() => this.selectedIds().size > 0);

  // ─── Tool and shortcut definitions (template data) ───────────────────────
  protected readonly toolDefs: { id: CanvasTool; icon: string; label: string }[] = [
    { id: 'select', icon: '↖', label: 'whiteboard.canvas.tool.select' },
    { id: 'pencil', icon: '✏', label: 'whiteboard.canvas.tool.pencil' },
    { id: 'rectangle', icon: '▭', label: 'whiteboard.canvas.tool.rectangle' },
    { id: 'ellipse', icon: '◯', label: 'whiteboard.canvas.tool.ellipse' },
    { id: 'text', icon: 'T', label: 'whiteboard.canvas.tool.text' },
    { id: 'erase', icon: '⌫', label: 'whiteboard.canvas.tool.erase' },
  ];

  protected readonly shortcuts: { key: string; label: string }[] = [
    { key: 'V', label: 'whiteboard.canvas.shortcuts.select' },
    { key: 'P', label: 'whiteboard.canvas.shortcuts.pencil' },
    { key: 'T', label: 'whiteboard.canvas.shortcuts.text' },
    { key: 'E', label: 'whiteboard.canvas.shortcuts.erase' },
    { key: 'R', label: 'whiteboard.canvas.shortcuts.rectangle' },
    { key: 'Ctrl+Z', label: 'whiteboard.canvas.shortcuts.undo' },
    { key: 'Ctrl+Y', label: 'whiteboard.canvas.shortcuts.redo' },
    { key: 'Ctrl+A', label: 'whiteboard.canvas.shortcuts.selectAll' },
    { key: 'Ctrl+D', label: 'whiteboard.canvas.shortcuts.duplicate' },
    { key: 'Ctrl+C', label: 'whiteboard.canvas.shortcuts.copy' },
    { key: 'Ctrl+V', label: 'whiteboard.canvas.shortcuts.paste' },
    { key: 'Ctrl+G', label: 'whiteboard.canvas.shortcuts.group' },
    { key: 'Ctrl+Shift+G', label: 'whiteboard.canvas.shortcuts.ungroup' },
    { key: 'Suppr', label: 'whiteboard.canvas.shortcuts.delete' },
    { key: 'Ctrl++', label: 'whiteboard.canvas.shortcuts.zoomIn' },
    { key: 'Ctrl+-', label: 'whiteboard.canvas.shortcuts.zoomOut' },
    { key: 'Ctrl+Molette', label: 'whiteboard.canvas.shortcuts.zoomWheel' },
    { key: 'Espace+Glisser', label: 'whiteboard.canvas.shortcuts.pan' },
    { key: '?', label: 'whiteboard.canvas.shortcuts.showShortcuts' },
  ];

  // ─── Internal drag/draw state (not signals — updated per frame) ──────────
  private ctx!: CanvasRenderingContext2D;
  private minimapCtx!: CanvasRenderingContext2D;
  private isDrawing = false;
  private isDragging = false;
  private isPanning = false;
  private isMarquee = false;
  private dragStartX = 0;
  private dragStartY = 0;
  private lastDragX = 0;
  private lastDragY = 0;
  private marqueeX = 0;
  private marqueeY = 0;
  private marqueeW = 0;
  private marqueeH = 0;
  private currentStroke: [number, number][] = [];
  private currentShape: Partial<ShapeObject> | null = null;
  private guides: AlignGuide = { x: null, y: null };
  private clipboard: CanvasObject[] = [];
  private resizingHandle: HandlePosition | null = null;
  private resizeOrigin: BoundingBox | null = null;
  /** Snapshot of the selected objects' geometry taken at resize start (US08.3.2a AC gap fix:
   *  real per-handle resize is computed from this fixed snapshot + the total pointer delta,
   *  never from cumulative per-frame deltas, so repeated frames never compound rounding error. */
  private resizeOriginalObjects: CanvasObject[] | null = null;
  private animFrameId: number | null = null;
  private dirtyFlag = false;
  protected spaceDown = false;
  private lastColor = COLOR_PALETTE[0];
  /** Element focused before the shortcuts dialog opened — focus returns here on close (a11y). */
  private dialogTriggerEl: HTMLElement | null = null;

  // ─── Lifecycle ───────────────────────────────────────────────────────────

  ngAfterViewInit(): void {
    const canvas = this.canvasRef.nativeElement;
    this.ctx = canvas.getContext('2d')!;
    this.minimapCtx = this.minimapRef.nativeElement.getContext('2d')!;
    this.resizeCanvas();
    this.scheduleRender();
  }

  ngOnDestroy(): void {
    if (this.animFrameId !== null) cancelAnimationFrame(this.animFrameId);
  }

  // ─── Canvas resize ────────────────────────────────────────────────────────

  @HostListener('window:resize')
  protected onWindowResize(): void {
    this.resizeCanvas();
    this.markDirty();
  }

  private resizeCanvas(): void {
    const el = this.canvasRef.nativeElement;
    const rect = el.getBoundingClientRect();
    el.width = rect.width || window.innerWidth;
    el.height = rect.height || window.innerHeight - 64;
    this.markDirty();
  }

  // ─── Render loop ──────────────────────────────────────────────────────────

  private markDirty(): void {
    this.dirtyFlag = true;
  }

  private scheduleRender(): void {
    const loop = () => {
      if (this.dirtyFlag) {
        this.dirtyFlag = false;
        this.render();
        this.renderMinimap();
      }
      this.animFrameId = requestAnimationFrame(loop);
    };
    this.animFrameId = requestAnimationFrame(loop);
  }

  private render(): void {
    const canvas = this.canvasRef.nativeElement;
    const ctx = this.ctx;
    const z = this.zoom();
    const px = this.panX();
    const py = this.panY();

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.setTransform(z, 0, 0, z, px, py);

    // Draw all objects
    for (const obj of this.objects()) {
      this.drawObject(ctx, obj);
    }

    // Draw in-progress stroke / shape
    if (this.isDrawing && this.activeTool() === 'pencil' && this.currentStroke.length > 1) {
      this.drawInProgressStroke(ctx);
    }
    if (this.isDrawing && this.currentShape) {
      this.drawInProgressShape(ctx);
    }

    // Draw selection handles
    const selIds = this.selectedIds();
    if (selIds.size > 0) {
      this.drawSelectionHandles(ctx);
    }

    // Draw marquee
    if (this.isMarquee) {
      ctx.strokeStyle = '#2196F3';
      ctx.lineWidth = 1 / z;
      ctx.setLineDash([4 / z, 4 / z]);
      ctx.strokeRect(this.marqueeX, this.marqueeY, this.marqueeW, this.marqueeH);
      ctx.setLineDash([]);
    }

    // Draw smart guides
    if (this.guides.x !== null) {
      ctx.strokeStyle = '#E91E63';
      ctx.lineWidth = 1 / z;
      ctx.beginPath();
      ctx.moveTo(this.guides.x, -10000);
      ctx.lineTo(this.guides.x, 10000);
      ctx.stroke();
    }
    if (this.guides.y !== null) {
      ctx.strokeStyle = '#E91E63';
      ctx.lineWidth = 1 / z;
      ctx.beginPath();
      ctx.moveTo(-10000, this.guides.y);
      ctx.lineTo(10000, this.guides.y);
      ctx.stroke();
    }

    ctx.restore();
  }

  private drawObject(ctx: CanvasRenderingContext2D, obj: CanvasObject): void {
    ctx.save();
    ctx.strokeStyle = obj.strokeColor;
    ctx.lineWidth = obj.lineWidth;
    ctx.fillStyle = obj.fillColor === 'transparent' ? 'rgba(0,0,0,0)' : obj.fillColor;

    switch (obj.kind) {
      case 'stroke':
        this.drawStroke(ctx, obj);
        break;
      case 'shape':
        this.drawShape(ctx, obj);
        break;
      case 'text':
        this.drawText(ctx, obj);
        break;
    }
    ctx.restore();
  }

  private drawStroke(ctx: CanvasRenderingContext2D, obj: StrokeObject): void {
    if (obj.points.length < 2) return;
    ctx.beginPath();
    ctx.moveTo(obj.points[0][0], obj.points[0][1]);
    for (let i = 1; i < obj.points.length; i++) {
      ctx.lineTo(obj.points[i][0], obj.points[i][1]);
    }
    ctx.stroke();
  }

  private drawShape(ctx: CanvasRenderingContext2D, obj: ShapeObject): void {
    const bbox = getBoundingBox(obj);
    if (obj.shape === 'rectangle') {
      ctx.beginPath();
      ctx.rect(bbox.x, bbox.y, bbox.width, bbox.height);
    } else {
      ctx.beginPath();
      ctx.ellipse(
        bbox.x + bbox.width / 2, bbox.y + bbox.height / 2,
        bbox.width / 2, bbox.height / 2,
        0, 0, Math.PI * 2,
      );
    }
    if (obj.fillColor !== 'transparent') ctx.fill();
    ctx.stroke();
  }

  private drawText(ctx: CanvasRenderingContext2D, obj: TextObject): void {
    ctx.font = `${obj.fontSize}px sans-serif`;
    ctx.fillStyle = obj.strokeColor;
    ctx.fillText(obj.content, obj.x, obj.y);
  }

  private drawInProgressStroke(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    ctx.strokeStyle = this.strokeColor();
    ctx.lineWidth = this.lineWidth();
    ctx.beginPath();
    ctx.moveTo(this.currentStroke[0][0], this.currentStroke[0][1]);
    for (let i = 1; i < this.currentStroke.length; i++) {
      ctx.lineTo(this.currentStroke[i][0], this.currentStroke[i][1]);
    }
    ctx.stroke();
    ctx.restore();
  }

  private drawInProgressShape(ctx: CanvasRenderingContext2D): void {
    const s = this.currentShape as ShapeObject;
    if (!s || !s.shape) return;
    ctx.save();
    ctx.strokeStyle = this.strokeColor();
    ctx.lineWidth = this.lineWidth();
    ctx.fillStyle = this.fillColor() === 'transparent' ? 'rgba(0,0,0,0)' : this.fillColor();
    ctx.setLineDash([4, 4]);
    this.drawShape(ctx, { ...s, strokeColor: this.strokeColor(), fillColor: this.fillColor(), lineWidth: this.lineWidth() } as ShapeObject);
    ctx.restore();
  }

  private drawSelectionHandles(ctx: CanvasRenderingContext2D): void {
    const z = this.zoom();
    const selObjs = this.objects().filter(o => this.selectedIds().has(o.id));
    if (!selObjs.length) return;

    const unionBBox = selObjs.reduce((acc, obj) => {
      const bb = getBoundingBox(obj);
      if (!acc) return bb;
      const x = Math.min(acc.x, bb.x);
      const y = Math.min(acc.y, bb.y);
      const x2 = Math.max(acc.x + acc.width, bb.x + bb.width);
      const y2 = Math.max(acc.y + acc.height, bb.y + bb.height);
      return { x, y, width: x2 - x, height: y2 - y };
    }, null as BoundingBox | null)!;

    // Selection outline
    ctx.save();
    ctx.strokeStyle = '#2196F3';
    ctx.lineWidth = 1.5 / z;
    ctx.setLineDash([4 / z, 2 / z]);
    ctx.strokeRect(unionBBox.x - 4 / z, unionBBox.y - 4 / z, unionBBox.width + 8 / z, unionBBox.height + 8 / z);
    ctx.setLineDash([]);

    // Resize handles (white squares with blue border)
    const hs = HANDLE_SIZE / z;
    const hx = unionBBox.x - hs / 2 - 4 / z;
    const hy = unionBBox.y - hs / 2 - 4 / z;
    const hw = unionBBox.width + 8 / z;
    const hh = unionBBox.height + 8 / z;
    const handles: [number, number][] = [
      [hx, hy], [hx + hw / 2, hy], [hx + hw, hy],
      [hx, hy + hh / 2], [hx + hw, hy + hh / 2],
      [hx, hy + hh], [hx + hw / 2, hy + hh], [hx + hw, hy + hh],
    ];
    ctx.strokeStyle = '#2196F3';
    ctx.lineWidth = 1 / z;
    ctx.fillStyle = '#ffffff';
    for (const [hpx, hpy] of handles) {
      ctx.fillRect(hpx - hs / 2, hpy - hs / 2, hs, hs);
      ctx.strokeRect(hpx - hs / 2, hpy - hs / 2, hs, hs);
    }
    ctx.restore();
  }

  private renderMinimap(): void {
    const mc = this.minimapRef.nativeElement;
    const ctx = this.minimapCtx;
    const mainCanvas = this.canvasRef.nativeElement;
    const scale = Math.min(mc.width / mainCanvas.width, mc.height / mainCanvas.height) * 0.9;
    ctx.clearRect(0, 0, mc.width, mc.height);
    ctx.save();
    ctx.scale(scale, scale);
    for (const obj of this.objects()) {
      this.drawObject(ctx, obj);
    }
    // Viewport rect
    const z = this.zoom();
    const vpX = -this.panX() / z;
    const vpY = -this.panY() / z;
    const vpW = mainCanvas.width / z;
    const vpH = mainCanvas.height / z;
    ctx.strokeStyle = '#2196F3';
    ctx.lineWidth = 2 / scale;
    ctx.strokeRect(vpX, vpY, vpW, vpH);
    ctx.restore();
  }

  // ─── Mouse / pointer events ───────────────────────────────────────────────

  protected onPointerDown(event: PointerEvent): void {
    if (this.readOnly()) return;
    const [cx, cy] = this.canvasCoords(event);
    this.canvasRef.nativeElement.setPointerCapture(event.pointerId);

    if (this.spaceDown) {
      this.isPanning = true;
      this.lastDragX = event.clientX;
      this.lastDragY = event.clientY;
      return;
    }

    const tool = this.activeTool();

    if (tool === 'select') {
      const clickedHandle = this.hitTestHandle(cx, cy);
      if (clickedHandle) {
        this.resizingHandle = clickedHandle;
        const selObjs = this.objects().filter(o => this.selectedIds().has(o.id));
        this.resizeOrigin = selObjs.reduce((acc, obj) => {
          const bb = getBoundingBox(obj);
          if (!acc) return bb;
          const x = Math.min(acc.x, bb.x), y = Math.min(acc.y, bb.y);
          const x2 = Math.max(acc.x + acc.width, bb.x + bb.width);
          const y2 = Math.max(acc.y + acc.height, bb.y + bb.height);
          return { x, y, width: x2 - x, height: y2 - y };
        }, null as BoundingBox | null);
        this.resizeOriginalObjects = selObjs.map(o => ({ ...o }));
        this.snapshotForUndo();
        this.dragStartX = cx;
        this.dragStartY = cy;
        return;
      }

      const hit = this.findHit(cx, cy);
      if (hit) {
        if (event.shiftKey) {
          const ids = new Set(this.selectedIds());
          if (ids.has(hit.id)) ids.delete(hit.id); else ids.add(hit.id);
          this.selectedIds.set(ids);
        } else {
          if (!this.selectedIds().has(hit.id)) {
            this.selectedIds.set(new Set([hit.id]));
          }
        }
        this.isDragging = true;
        this.dragStartX = cx;
        this.dragStartY = cy;
        this.lastDragX = cx;
        this.lastDragY = cy;
        this.snapshotForUndo();
      } else {
        if (!event.shiftKey) this.selectedIds.set(new Set());
        this.isMarquee = true;
        this.marqueeX = cx;
        this.marqueeY = cy;
        this.marqueeW = 0;
        this.marqueeH = 0;
      }
    } else if (tool === 'pencil') {
      this.isDrawing = true;
      this.currentStroke = [[cx, cy]];
    } else if (tool === 'rectangle' || tool === 'ellipse') {
      this.isDrawing = true;
      this.currentShape = {
        kind: 'shape',
        shape: tool === 'rectangle' ? 'rectangle' : 'ellipse',
        x: cx, y: cy, width: 0, height: 0,
      };
      this.dragStartX = cx;
      this.dragStartY = cy;
    } else if (tool === 'text') {
      this.startTextEdit(cx, cy, null);
    } else if (tool === 'erase') {
      this.eraseAt(cx, cy);
    }

    this.markDirty();
  }

  protected onPointerMove(event: PointerEvent): void {
    if (this.readOnly()) return;
    const [cx, cy] = this.canvasCoords(event);

    if (this.isPanning) {
      const dx = event.clientX - this.lastDragX;
      const dy = event.clientY - this.lastDragY;
      this.panX.update(v => v + dx);
      this.panY.update(v => v + dy);
      this.lastDragX = event.clientX;
      this.lastDragY = event.clientY;
      this.markDirty();
      return;
    }

    if (this.resizingHandle && this.resizeOrigin) {
      // Real per-handle resize (8 handles: corners resize both dimensions, edges resize one).
      // `dragStartX/Y` are the fixed drag-start point (never reassigned during resize, unlike
      // the drag-move path) so `dx`/`dy` are the *total* delta from resize start, applied to
      // the `resizeOriginalObjects` snapshot — never compounded frame-over-frame.
      const dx = cx - this.dragStartX;
      const dy = cy - this.dragStartY;
      this.resizeSelected(this.resizingHandle, this.resizeOrigin, dx, dy);
      this.markDirty();
      return;
    }

    if (this.isDragging) {
      const dx = cx - this.lastDragX;
      const dy = cy - this.lastDragY;
      this.computeGuides(cx, cy);
      const snappedDx = this.guides.x !== null ? dx + (this.guides.x - (cx - this.dragStartX) * 0) : dx;
      const snappedDy = this.guides.y !== null ? dy : dy;
      this.moveSelected(snappedDx, snappedDy);
      this.lastDragX = cx;
      this.lastDragY = cy;
      this.markDirty();
      return;
    }

    if (this.isMarquee) {
      this.marqueeW = cx - this.marqueeX;
      this.marqueeH = cy - this.marqueeY;
      this.markDirty();
      return;
    }

    if (this.isDrawing) {
      const tool = this.activeTool();
      if (tool === 'pencil') {
        this.currentStroke.push([cx, cy]);
      } else if (this.currentShape) {
        this.currentShape = {
          ...this.currentShape,
          width: cx - this.dragStartX,
          height: cy - this.dragStartY,
        };
      }
      if (tool === 'erase') this.eraseAt(cx, cy);
      this.markDirty();
    }
  }

  protected onPointerUp(event: PointerEvent): void {
    if (this.readOnly()) return;
    const [cx, cy] = this.canvasCoords(event);
    this.canvasRef.nativeElement.releasePointerCapture(event.pointerId);

    if (this.isPanning) { this.isPanning = false; return; }
    if (this.resizingHandle) {
      const selObjs = this.objects().filter(o => this.selectedIds().has(o.id));
      this.resizingHandle = null;
      this.resizeOrigin = null;
      this.resizeOriginalObjects = null;
      this.markDirty();
      this.emitDraw('resize', selObjs);
      return;
    }

    if (this.isDragging) {
      this.isDragging = false;
      this.guides = { x: null, y: null };
      this.markDirty();
      const selObjs = this.objects().filter(o => this.selectedIds().has(o.id));
      this.emitDraw('move', selObjs);
    }

    if (this.isMarquee) {
      this.isMarquee = false;
      this.selectByMarquee();
      this.markDirty();
    }

    if (this.isDrawing) {
      this.isDrawing = false;
      const tool = this.activeTool();
      if (tool === 'pencil' && this.currentStroke.length >= 2) {
        const obj: StrokeObject = {
          id: crypto.randomUUID(),
          kind: 'stroke',
          points: [...this.currentStroke],
          strokeColor: this.strokeColor(),
          fillColor: 'transparent',
          lineWidth: this.lineWidth(),
        };
        this.addObject(obj);
        this.emitDraw('stroke', obj);
      } else if ((tool === 'rectangle' || tool === 'ellipse') && this.currentShape) {
        const s = this.currentShape as ShapeObject;
        if (Math.abs(s.width ?? 0) > 2 && Math.abs(s.height ?? 0) > 2) {
          const obj: ShapeObject = {
            id: crypto.randomUUID(),
            kind: 'shape',
            shape: tool === 'rectangle' ? 'rectangle' : 'ellipse',
            x: s.x!, y: s.y!,
            width: cx - this.dragStartX,
            height: cy - this.dragStartY,
            strokeColor: this.strokeColor(),
            fillColor: this.fillColor(),
            lineWidth: this.lineWidth(),
          };
          this.addObject(obj);
          this.emitDraw('shape', obj);
        }
      }
      this.currentStroke = [];
      this.currentShape = null;
      this.markDirty();
    }
  }

  protected onDoubleClick(event: MouseEvent): void {
    if (this.readOnly() || this.activeTool() !== 'text') return;
    const [cx, cy] = this.canvasCoords(event as unknown as PointerEvent);
    const hit = this.findHit(cx, cy);
    if (hit && hit.kind === 'text') {
      this.startTextEdit(cx, cy, hit);
    } else if (!hit) {
      this.startTextEdit(cx, cy, null);
    }
  }

  protected onWheel(event: WheelEvent): void {
    if (!event.ctrlKey) return;
    event.preventDefault();
    const zoomDelta = event.deltaY > 0 ? 0.9 : 1.1;
    const newZoom = Math.min(10, Math.max(0.1, this.zoom() * zoomDelta));
    const rect = this.canvasRef.nativeElement.getBoundingClientRect();
    const mouseX = event.clientX - rect.left;
    const mouseY = event.clientY - rect.top;
    this.panX.update(v => mouseX - (mouseX - v) * (newZoom / this.zoom()));
    this.panY.update(v => mouseY - (mouseY - v) * (newZoom / this.zoom()));
    this.zoom.set(newZoom);
    this.markDirty();
  }

  // ─── Keyboard shortcuts ───────────────────────────────────────────────────

  @HostListener('window:keydown', ['$event'])
  protected onKeyDown(e: KeyboardEvent): void {
    if (this.isEditingText()) return;
    if (this.readOnly()) {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'y')) e.preventDefault();
      return;
    }

    // Keyboard-shortcuts dialog focus trap (WCAG 2.1 AA — US08.3.2a AC gap fix). While the
    // dialog is open, Tab/Shift+Tab cycle within it and Escape/'?' close it; every other
    // shortcut below is swallowed so e.g. Ctrl+Z or a tool letter can never fire "through" the
    // open modal (standard dialog behaviour: background is inert while it's up).
    if (this.showShortcutDialog()) {
      if (e.key === 'Escape' || e.key === '?') { e.preventDefault(); this.closeShortcutDialog(); return; }
      if (e.key === 'Tab') { this.trapDialogTab(e); return; }
      return;
    }

    const ctrl = e.ctrlKey || e.metaKey;

    // Tool shortcuts
    const toolMap: Record<string, CanvasTool> = {
      v: 'select', p: 'pencil', t: 'text', e: 'erase', r: 'rectangle',
    };
    if (!ctrl && toolMap[e.key.toLowerCase()]) {
      this.activeTool.set(toolMap[e.key.toLowerCase()]);
      return;
    }

    if (e.key === ' ') { this.spaceDown = true; return; }
    if (e.key === '?') { this.openShortcutDialog(); return; }

    if (ctrl) {
      switch (e.key.toLowerCase()) {
        case 'z': e.preventDefault(); this.onUndo(); break;
        case 'y': e.preventDefault(); this.onRedo(); break;
        case 'a': e.preventDefault(); this.selectAll(); break;
        case 'd': e.preventDefault(); if (this.hasSelection()) this.duplicate(); break;
        case 'c': e.preventDefault(); if (this.hasSelection()) this.copy(); break;
        case 'v': e.preventDefault(); this.paste(); break;
        case 'g':
          e.preventDefault();
          if (e.shiftKey) this.ungroup();
          else if (this.canGroup()) this.group();
          break;
        case '+': case '=': e.preventDefault(); this.zoomIn(); break;
        case '-': e.preventDefault(); this.zoomOut(); break;
      }
    }

    if ((e.key === 'Delete' || e.key === 'Backspace') && this.hasSelection()) {
      e.preventDefault();
      this.deleteSelected();
    }

    // Arrow keys: move selected by 1px
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key) && this.hasSelection()) {
      e.preventDefault();
      const step = e.shiftKey ? 10 : 1;
      const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
      const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
      this.snapshotForUndo();
      this.moveSelected(dx, dy);
      this.markDirty();
    }
  }

  @HostListener('window:keyup', ['$event'])
  protected onKeyUp(e: KeyboardEvent): void {
    if (e.key === ' ') { this.spaceDown = false; this.isPanning = false; }
  }

  // ─── Tool actions ─────────────────────────────────────────────────────────

  protected setTool(tool: CanvasTool): void {
    if (!this.readOnly()) this.activeTool.set(tool);
  }

  protected setStrokeColor(color: string): void {
    if (!HEX_REGEX.test(color)) return;
    this.strokeColor.set(color);
    this.lastColor = color;
    this.showColorPicker.set(false);
  }

  protected setCustomColor(): void {
    const val = '#' + this.customHexInput().replace('#', '');
    if (HEX_REGEX.test(val)) {
      this.setStrokeColor(val);
      this.customHexError.set(false);
    } else {
      this.customHexError.set(true);
    }
  }

  protected onCustomHexChange(value: string): void {
    this.customHexInput.set(value);
    this.customHexError.set(false);
  }

  private selectAll(): void {
    this.selectedIds.set(new Set(this.objects().map(o => o.id)));
    this.markDirty();
  }

  private deleteSelected(): void {
    if (!this.hasSelection()) return;
    this.snapshotForUndo();
    const ids = this.selectedIds();
    this.objects.update(objs => objs.filter(o => !ids.has(o.id)));
    this.selectedIds.set(new Set());
    this.markDirty();
  }

  private duplicate(): void {
    if (!this.hasSelection()) return;
    this.snapshotForUndo();
    const ids = this.selectedIds();
    const originals = this.objects().filter(o => ids.has(o.id));
    const copies = originals.map(obj => {
      const newId = crypto.randomUUID();
      return this.clampToCanvas(
        translateObject({ ...obj, id: newId }, DUPLICATE_OFFSET, DUPLICATE_OFFSET),
      );
    });
    this.objects.update(objs => [...objs, ...copies]);
    this.selectedIds.set(new Set(copies.map(c => c.id)));
    this.markDirty();
    // Real bug fix (US08.3.2a gap): each copy must emit its own DRAW subtype matching its
    // actual kind — `CanvasObject.kind` ('stroke'|'shape'|'text') maps 1:1 onto the DRAW
    // subtypes already used for the initial creation of each object type (see onPointerUp /
    // commitTextEdit above), so mirroring that convention here is a direct passthrough of
    // `c.kind`, not a new mapping to maintain in parallel.
    for (const c of copies) this.emitDraw(c.kind, c);
  }

  private copy(): void {
    if (!this.hasSelection()) return;
    const ids = this.selectedIds();
    this.clipboard = this.objects()
      .filter(o => ids.has(o.id))
      .map(o => ({ ...o }));
  }

  private paste(): void {
    if (!this.clipboard.length) return;
    this.snapshotForUndo();
    const copies = this.clipboard.map(obj => {
      const newId = crypto.randomUUID();
      return this.clampToCanvas(
        translateObject({ ...obj, id: newId }, DUPLICATE_OFFSET, DUPLICATE_OFFSET),
      );
    });
    this.objects.update(objs => [...objs, ...copies]);
    this.selectedIds.set(new Set(copies.map(c => c.id)));
    this.markDirty();
  }

  private group(): void {
    if (!this.canGroup()) return;
    this.snapshotForUndo();
    const groupId = crypto.randomUUID();
    const ids = this.selectedIds();
    this.objects.update(objs => objs.map(o => ids.has(o.id) ? { ...o, groupId } : o));
    this.markDirty();
  }

  private ungroup(): void {
    const ids = this.selectedIds();
    const groupIds = new Set(
      this.objects()
        .filter(o => ids.has(o.id) && o.groupId)
        .map(o => o.groupId!)
    );
    if (!groupIds.size) return;
    this.snapshotForUndo();
    this.objects.update(objs => objs.map(o => groupIds.has(o.groupId ?? '') ? { ...o, groupId: undefined } : o));
    this.markDirty();
  }

  /**
   * Undoes the last local action (US08.3.3 AC1). No-op while read-only (WS disconnected
   * or browser offline, AC10) — checked explicitly here rather than relying solely on
   * the toolbar `[disabled]`/keyboard-shortcut guards, so that no local mutation is
   * possible via any call path while read-only. On success, emits {@link undoAction}
   * so `WhiteboardBoardComponent` can relay `UNDO { eventId }` over STOMP (AC5).
   */
  protected onUndo(): void {
    if (this.readOnly()) return;
    const result = this.undoRedo.undo(this.objects());
    if (result) {
      this.objects.set(result.objects);
      this.selectedIds.set(new Set());
      this.markDirty();
      this.undoAction.emit({ eventId: result.eventId });
    }
  }

  /**
   * Redoes the last undone local action (US08.3.3 AC2). No-op while read-only, same
   * rationale as {@link onUndo}. Purely local — no STOMP message is sent (the wire
   * contract only defines `UNDO`).
   */
  protected onRedo(): void {
    if (this.readOnly()) return;
    const result = this.undoRedo.redo(this.objects());
    if (result) { this.objects.set(result); this.selectedIds.set(new Set()); this.markDirty(); }
  }

  protected zoomIn(): void {
    this.zoom.update(z => Math.min(10, z * 1.2));
    this.markDirty();
  }

  protected zoomOut(): void {
    this.zoom.update(z => Math.max(0.1, z / 1.2));
    this.markDirty();
  }

  protected toggleMinimap(): void {
    this.showMinimap.update(v => !v);
  }

  // ─── Keyboard-shortcuts dialog — focus trap (WCAG 2.1 AA) ────────────────

  /** Toggle used by the toolbar `?` button (template) — opens/closes with the same focus
   *  management as the `?`/`Escape` keyboard shortcuts. */
  protected toggleShortcutDialog(): void {
    if (this.showShortcutDialog()) this.closeShortcutDialog();
    else this.openShortcutDialog();
  }

  private openShortcutDialog(): void {
    this.dialogTriggerEl = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.showShortcutDialog.set(true);
    // Dialog content is behind `@if` — wait one tick for it to render before moving focus in,
    // same convention already used by `startTextEdit` for the text-edit overlay below.
    setTimeout(() => this.focusFirstInDialog(), 0);
  }

  /** Closes the dialog and returns focus to the element that opened it (WCAG 2.1 AA). */
  protected closeShortcutDialog(): void {
    if (!this.showShortcutDialog()) return;
    this.showShortcutDialog.set(false);
    this.dialogTriggerEl?.focus();
    this.dialogTriggerEl = null;
  }

  private focusFirstInDialog(): void {
    const container = this.dialogRef?.nativeElement;
    const focusable = container ? this.getFocusableElements(container) : [];
    (focusable[0] ?? container)?.focus();
  }

  /** Traps Tab/Shift+Tab within the dialog while it is open (WCAG 2.1 AA keyboard.checklist). */
  private trapDialogTab(e: KeyboardEvent): void {
    const container = this.dialogRef?.nativeElement;
    if (!container) return;
    const focusable = this.getFocusableElements(container);
    if (!focusable.length) { e.preventDefault(); return; }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;
    if (e.shiftKey) {
      if (active === first || !container.contains(active)) { e.preventDefault(); last.focus(); }
    } else if (active === last || !container.contains(active)) {
      e.preventDefault();
      first.focus();
    }
  }

  private getFocusableElements(container: HTMLElement): HTMLElement[] {
    const selector = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
    return Array.from(container.querySelectorAll<HTMLElement>(selector)).filter(
      el => !el.hasAttribute('disabled'),
    );
  }

  protected onGroup(): void { if (!this.readOnly()) this.group(); }
  protected onUngroup(): void { if (!this.readOnly()) this.ungroup(); }
  protected onDuplicate(): void { if (!this.readOnly()) this.duplicate(); }

  // ─── Text editing ─────────────────────────────────────────────────────────

  private startTextEdit(cx: number, cy: number, existing: TextObject | null): void {
    this.isEditingText.set(true);
    this.textEditX.set(cx * this.zoom() + this.panX());
    this.textEditY.set(cy * this.zoom() + this.panY());
    this.editingObjectId.set(existing?.id ?? null);
    setTimeout(() => {
      const ta = this.textInputRef?.nativeElement;
      if (ta) {
        ta.value = existing?.content ?? '';
        ta.focus();
      }
    }, 0);
  }

  protected commitTextEdit(value: string): void {
    if (!this.isEditingText()) return;
    const content = value.slice(0, MAX_TEXT_LENGTH);
    const cx = (this.textEditX() - this.panX()) / this.zoom();
    const cy = (this.textEditY() - this.panY()) / this.zoom();
    const existingId = this.editingObjectId();

    if (existingId) {
      this.objects.update(objs => objs.map(o =>
        o.id === existingId && o.kind === 'text' ? { ...o, content } : o
      ));
    } else if (content.trim()) {
      this.snapshotForUndo();
      const obj: TextObject = {
        id: crypto.randomUUID(),
        kind: 'text', x: cx, y: cy, content,
        fontSize: 16,
        strokeColor: this.strokeColor(),
        fillColor: 'transparent',
        lineWidth: 1,
      };
      this.addObject(obj);
      this.emitDraw('text', obj);
    }

    this.isEditingText.set(false);
    this.editingObjectId.set(null);
    this.markDirty();
  }

  protected cancelTextEdit(): void {
    this.isEditingText.set(false);
    this.editingObjectId.set(null);
  }

  // ─── Helper methods ───────────────────────────────────────────────────────

  private canvasCoords(event: PointerEvent | MouseEvent): [number, number] {
    const rect = this.canvasRef.nativeElement.getBoundingClientRect();
    const x = ((event.clientX - rect.left) - this.panX()) / this.zoom();
    const y = ((event.clientY - rect.top) - this.panY()) / this.zoom();
    return [x, y];
  }

  private findHit(cx: number, cy: number): CanvasObject | null {
    const objs = this.objects();
    for (let i = objs.length - 1; i >= 0; i--) {
      if (hitTest(objs[i], cx, cy)) return objs[i];
    }
    return null;
  }

  private eraseAt(cx: number, cy: number): void {
    const hit = this.findHit(cx, cy);
    if (hit) {
      this.snapshotForUndo();
      this.objects.update(objs => objs.filter(o => o.id !== hit.id));
      this.selectedIds.update(ids => { const n = new Set(ids); n.delete(hit.id); return n; });
      this.markDirty();
      this.emitDraw('erase', { id: hit.id });
    }
  }

  private addObject(obj: CanvasObject): void {
    this.snapshotForUndo();
    this.objects.update(objs => [...objs, obj]);
    this.selectedIds.set(new Set([obj.id]));
    this.markDirty();
  }

  private moveSelected(dx: number, dy: number): void {
    const ids = this.selectedIds();
    const groupIds = new Set(
      this.objects()
        .filter(o => ids.has(o.id) && o.groupId)
        .map(o => o.groupId!)
    );
    this.objects.update(objs => objs.map(o => {
      if (ids.has(o.id) || (o.groupId && groupIds.has(o.groupId))) {
        return this.clampToCanvas(translateObject(o, dx, dy));
      }
      return o;
    }));
    this.markDirty();
  }

  /**
   * Resizes the current selection from a drag handle (US08.3.2a AC gap fix — previously this
   * only translated objects, see git history). `origin` is the union bounding box of the
   * selection captured at drag start; `dx`/`dy` is the *total* pointer delta since then.
   *
   * Every selected object is scaled from {@link resizeOriginalObjects} (its geometry at drag
   * start) around the handle's fixed anchor point ({@link resizeAnchor}) by the ratio between
   * the new and original union bbox ({@link resizeBBox}) — a multi-object selection therefore
   * resizes proportionally as one group, and a single-object selection resizes exactly as
   * dragged. The result is clamped to canvas bounds via {@link clampToCanvas} so a shape can
   * never end up with a negative size or drift outside the visible canvas.
   */
  private resizeSelected(handle: HandlePosition, origin: BoundingBox, dx: number, dy: number): void {
    const originals = this.resizeOriginalObjects;
    if (!originals) return;
    const newBBox = resizeBBox(origin, handle, dx, dy);
    const anchor = resizeAnchor(origin, handle);
    const scaleX = origin.width !== 0 ? newBBox.width / origin.width : 1;
    const scaleY = origin.height !== 0 ? newBBox.height / origin.height : 1;
    const byId = new Map(originals.map(o => [o.id, o]));

    this.objects.update(objs => objs.map(o => {
      const original = byId.get(o.id);
      if (!original) return o;
      const scaled = scaleObject(original, anchor.x, anchor.y, scaleX, scaleY);
      return this.clampToCanvas(scaled);
    }));
  }

  /**
   * Clamps an object's geometry to the canvas bounds (US08.3.2a AC gap fix — {@link clampShape}
   * previously existed only as unit-tested, dead code; this is the single call site wiring it
   * into every real drag/resize/move code path via {@link clampObjectToCanvas}, which dispatches
   * to {@link clampShape} for shapes and generalises the same clamp to strokes/text).
   */
  private clampToCanvas(obj: CanvasObject): CanvasObject {
    const canvas = this.canvasRef.nativeElement;
    return clampObjectToCanvas(obj, canvas.width, canvas.height);
  }

  private selectByMarquee(): void {
    const mx = Math.min(this.marqueeX, this.marqueeX + this.marqueeW);
    const my = Math.min(this.marqueeY, this.marqueeY + this.marqueeH);
    const mw = Math.abs(this.marqueeW);
    const mh = Math.abs(this.marqueeH);
    const marquee: BoundingBox = { x: mx, y: my, width: mw, height: mh };
    const newIds = new Set(this.selectedIds());
    for (const obj of this.objects()) {
      const bb = getBoundingBox(obj);
      if (bboxIntersects(bb, marquee)) newIds.add(obj.id);
    }
    this.selectedIds.set(newIds);
  }

  private computeGuides(_cx: number, _cy: number): void {
    const ids = this.selectedIds();
    const selObjs = this.objects().filter(o => ids.has(o.id));
    const others = this.objects().filter(o => !ids.has(o.id));
    if (!selObjs.length || !others.length) { this.guides = { x: null, y: null }; return; }

    const selBBox = selObjs.reduce((acc, obj) => {
      const bb = getBoundingBox(obj);
      if (!acc) return bb;
      return {
        x: Math.min(acc.x, bb.x), y: Math.min(acc.y, bb.y),
        width: Math.max(acc.x + acc.width, bb.x + bb.width) - Math.min(acc.x, bb.x),
        height: Math.max(acc.y + acc.height, bb.y + bb.height) - Math.min(acc.y, bb.y),
      };
    }, null as BoundingBox | null)!;

    let guideX: number | null = null;
    let guideY: number | null = null;

    for (const other of others) {
      const bb = getBoundingBox(other);
      // X alignment: left, center, right of other vs left, center, right of sel
      for (const ox of [bb.x, bb.x + bb.width / 2, bb.x + bb.width]) {
        for (const sx of [selBBox.x, selBBox.x + selBBox.width / 2, selBBox.x + selBBox.width]) {
          if (Math.abs(ox - sx) <= SNAP_TOLERANCE) { guideX = ox; break; }
        }
        if (guideX !== null) break;
      }
      // Y alignment
      for (const oy of [bb.y, bb.y + bb.height / 2, bb.y + bb.height]) {
        for (const sy of [selBBox.y, selBBox.y + selBBox.height / 2, selBBox.y + selBBox.height]) {
          if (Math.abs(oy - sy) <= SNAP_TOLERANCE) { guideY = oy; break; }
        }
        if (guideY !== null) break;
      }
    }

    this.guides = { x: guideX, y: guideY };
    this.markDirty();
  }

  private hitTestHandle(cx: number, cy: number): HandlePosition | null {
    if (!this.selectedIds().size) return null;
    const selObjs = this.objects().filter(o => this.selectedIds().has(o.id));
    if (!selObjs.length) return null;
    const unionBBox = selObjs.reduce((acc, obj) => {
      const bb = getBoundingBox(obj);
      if (!acc) return bb;
      return {
        x: Math.min(acc.x, bb.x), y: Math.min(acc.y, bb.y),
        width: Math.max(acc.x + acc.width, bb.x + bb.width) - Math.min(acc.x, bb.x),
        height: Math.max(acc.y + acc.height, bb.y + bb.height) - Math.min(acc.y, bb.y),
      };
    }, null as BoundingBox | null)!;

    const z = this.zoom();
    const hs = HANDLE_SIZE / z;
    const hx = unionBBox.x - 4 / z;
    const hy = unionBBox.y - 4 / z;
    const hw = unionBBox.width + 8 / z;
    const hh = unionBBox.height + 8 / z;

    const positions: [number, number, HandlePosition][] = [
      [hx, hy, 'tl'], [hx + hw / 2, hy, 't'], [hx + hw, hy, 'tr'],
      [hx, hy + hh / 2, 'l'], [hx + hw, hy + hh / 2, 'r'],
      [hx, hy + hh, 'bl'], [hx + hw / 2, hy + hh, 'b'], [hx + hw, hy + hh, 'br'],
    ];

    for (const [hpx, hpy, pos] of positions) {
      const bbox: BoundingBox = { x: hpx - hs / 2, y: hpy - hs / 2, width: hs, height: hs };
      if (pointInBBox(bbox, cx, cy)) return pos;
    }
    return null;
  }

  private snapshotForUndo(): void {
    this.undoRedo.push(this.objects());
  }

  private emitDraw(subType: DrawAction['subType'], payload: unknown): void {
    this.drawAction.emit({ type: 'DRAW', subType, payload });
  }

  /** Applies a remote DRAW action received from another participant (called by WhiteboardSyncService). */
  applyRemoteAction(action: DrawAction): void {
    if (action.type !== 'DRAW') return;
    switch (action.subType) {
      case 'stroke':
      case 'shape':
      case 'text': {
        const obj = action.payload as CanvasObject;
        if (obj?.id) {
          this.objects.update(objs => [...objs.filter(o => o.id !== obj.id), obj]);
          this.markDirty();
        }
        break;
      }
      case 'erase': {
        const { id } = action.payload as { id: string };
        this.objects.update(objs => objs.filter(o => o.id !== id));
        this.markDirty();
        break;
      }
      case 'move': {
        const moved = action.payload as CanvasObject[];
        if (Array.isArray(moved)) {
          const map = new Map(moved.map(o => [o.id, o]));
          this.objects.update(objs => objs.map(o => map.get(o.id) ?? o));
          this.markDirty();
        }
        break;
      }
    }
  }
}

function bboxIntersects(a: BoundingBox, b: BoundingBox): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x &&
    a.y < b.y + b.height && a.y + a.height > b.y;
}
