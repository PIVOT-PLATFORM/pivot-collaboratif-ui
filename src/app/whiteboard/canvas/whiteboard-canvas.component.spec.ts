import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TranslocoTestingModule } from '@jsverse/transloco';
import { WhiteboardCanvasComponent } from './whiteboard-canvas.component';
import { CanvasObject, StrokeObject, ShapeObject, COLOR_PALETTE, HEX_REGEX } from './model/canvas.model';
import { clampShape, getBoundingBox, hitTest, translateObject } from './model/canvas-geometry';
import { UndoRedoService } from '../../core/whiteboard/undo-redo.service';

// ─── Utility helpers ──────────────────────────────────────────────────────────

function makeStroke(id = 'stroke-1'): StrokeObject {
  return {
    id,
    kind: 'stroke',
    points: [[10, 10], [20, 20], [30, 30]],
    strokeColor: '#000000',
    fillColor: 'transparent',
    lineWidth: 2,
  };
}

function makeRect(id = 'rect-1', x = 50, y = 50, w = 100, h = 60): ShapeObject {
  return {
    id,
    kind: 'shape',
    shape: 'rectangle',
    x, y, width: w, height: h,
    strokeColor: '#E91E63',
    fillColor: 'transparent',
    lineWidth: 1,
  };
}

// ─── Model unit tests (no DOM required) ──────────────────────────────────────

describe('CanvasModel — COLOR_PALETTE', () => {
  it('contains exactly 12 colours', () => {
    expect(COLOR_PALETTE).toHaveLength(12);
  });

  it('every colour matches the strict hex regex', () => {
    for (const c of COLOR_PALETTE) {
      expect(HEX_REGEX.test(c)).toBe(true);
    }
  });
});

describe('HEX_REGEX', () => {
  it('accepts valid 6-digit hex colours', () => {
    expect(HEX_REGEX.test('#E91E63')).toBe(true);
    expect(HEX_REGEX.test('#000000')).toBe(true);
    expect(HEX_REGEX.test('#ffffff')).toBe(true);
  });

  it('rejects invalid colour strings', () => {
    expect(HEX_REGEX.test('#xyz')).toBe(false);
    expect(HEX_REGEX.test('E91E63')).toBe(false);         // missing #
    expect(HEX_REGEX.test('#E91E6')).toBe(false);          // 5 digits
    expect(HEX_REGEX.test('url(evil)')).toBe(false);       // CSS injection attempt
    expect(HEX_REGEX.test('expression(alert(1))')).toBe(false);
  });
});

// ─── Geometry unit tests ──────────────────────────────────────────────────────

describe('getBoundingBox', () => {
  it('computes correct bbox for a shape', () => {
    const rect = makeRect('r', 10, 20, 100, 50);
    const bb = getBoundingBox(rect);
    expect(bb.x).toBe(10);
    expect(bb.y).toBe(20);
    expect(bb.width).toBe(100);
    expect(bb.height).toBe(50);
  });

  it('handles negative shape dimensions (drag upwards)', () => {
    const rect = makeRect('r', 100, 100, -60, -40);
    const bb = getBoundingBox(rect);
    expect(bb.x).toBe(40);
    expect(bb.y).toBe(60);
    expect(bb.width).toBe(60);
    expect(bb.height).toBe(40);
  });

  it('computes stroke bbox including lineWidth padding', () => {
    const stroke = makeStroke();
    const bb = getBoundingBox(stroke);
    expect(bb.x).toBeLessThanOrEqual(10);
    expect(bb.y).toBeLessThanOrEqual(10);
    expect(bb.width).toBeGreaterThan(0);
    expect(bb.height).toBeGreaterThan(0);
  });
});

describe('hitTest', () => {
  it('detects a point inside a rectangle', () => {
    const rect = makeRect();
    expect(hitTest(rect, 80, 70)).toBe(true);
  });

  it('misses a point outside a rectangle', () => {
    const rect = makeRect();
    expect(hitTest(rect, 200, 200)).toBe(false);
  });

  it('detects a point near a stroke segment', () => {
    const stroke = makeStroke();
    expect(hitTest(stroke, 20, 20)).toBe(true);
  });

  it('misses a point far from a stroke', () => {
    const stroke = makeStroke();
    expect(hitTest(stroke, 200, 200)).toBe(false);
  });
});

describe('translateObject', () => {
  it('translates a shape object by dx/dy', () => {
    const rect = makeRect('r', 10, 20, 50, 40);
    const translated = translateObject(rect, 5, -10) as ShapeObject;
    expect(translated.x).toBe(15);
    expect(translated.y).toBe(10);
    expect(translated.width).toBe(50);  // dimensions unchanged
  });

  it('translates all points in a stroke', () => {
    const stroke = makeStroke();
    const translated = translateObject(stroke, 10, 10) as StrokeObject;
    expect(translated.points[0]).toEqual([20, 20]);
    expect(translated.points[1]).toEqual([30, 30]);
  });

  it('returns a new object without mutating the original', () => {
    const rect = makeRect();
    const translated = translateObject(rect, 5, 5);
    expect(translated).not.toBe(rect);
    expect(rect.x).toBe(50); // original unchanged
  });
});

// ─── UndoRedoService unit tests ───────────────────────────────────────────────

describe('UndoRedoService', () => {
  let service: UndoRedoService;

  beforeEach(() => {
    service = new UndoRedoService();
  });

  it('starts with canUndo=false and canRedo=false', () => {
    expect(service.canUndo()).toBe(false);
    expect(service.canRedo()).toBe(false);
  });

  it('push enables canUndo', () => {
    service.push([makeRect()]);
    expect(service.canUndo()).toBe(true);
    expect(service.canRedo()).toBe(false);
  });

  it('undo returns the previous state and enables canRedo', () => {
    const obj = makeRect();
    service.push([obj]);
    const current: CanvasObject[] = [];
    const result = service.undo(current);
    expect(result).toEqual([obj]);
    expect(service.canUndo()).toBe(false);
    expect(service.canRedo()).toBe(true);
  });

  it('redo returns the undone state', () => {
    const obj = makeRect();
    service.push([obj]);
    const undone = service.undo([]);
    expect(undone).toEqual([obj]);
    const redone = service.redo([]);
    expect(redone).not.toBeNull();
  });

  it('undo returns null when stack is empty', () => {
    expect(service.undo([])).toBeNull();
  });

  it('redo returns null when redo stack is empty', () => {
    expect(service.redo([])).toBeNull();
  });

  it('push after undo clears the redo stack', () => {
    service.push([makeRect()]);
    service.undo([]);
    expect(service.canRedo()).toBe(true);
    service.push([makeRect('r2')]);
    expect(service.canRedo()).toBe(false);
  });

  it('limits the undo stack to 50 entries', () => {
    for (let i = 0; i < 60; i++) {
      service.push([makeRect(`rect-${i}`)]);
    }
    // Undo 60 times — should only succeed 50 times
    let count = 0;
    let current: CanvasObject[] = [];
    while (service.canUndo()) {
      current = service.undo(current) ?? current;
      count++;
    }
    expect(count).toBe(50);
  });

  it('reset clears both stacks', () => {
    service.push([makeRect()]);
    service.push([makeRect('r2')]);
    service.reset();
    expect(service.canUndo()).toBe(false);
    expect(service.canRedo()).toBe(false);
  });
});

// ─── Component integration tests ─────────────────────────────────────────────

describe('WhiteboardCanvasComponent', () => {
  let fixture: ComponentFixture<WhiteboardCanvasComponent>;
  let component: WhiteboardCanvasComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [
        WhiteboardCanvasComponent,
        TranslocoTestingModule.forRoot({
          langs: { fr: {}, en: {} },
          translocoConfig: { defaultLang: 'fr', availableLangs: ['fr', 'en'] },
          preloadLangs: true,
        }),
      ],
    }).compileComponents();

    // Mock canvas context (jsdom has no real Canvas 2D)
    HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue({
      clearRect: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      stroke: vi.fn(),
      fill: vi.fn(),
      fillText: vi.fn(),
      rect: vi.fn(),
      ellipse: vi.fn(),
      strokeRect: vi.fn(),
      fillRect: vi.fn(),
      setTransform: vi.fn(),
      setLineDash: vi.fn(),
      scale: vi.fn(),
    }) as unknown as typeof HTMLCanvasElement.prototype.getContext;

    HTMLCanvasElement.prototype.getBoundingClientRect = vi.fn().mockReturnValue({
      left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600,
    }) as unknown as typeof HTMLCanvasElement.prototype.getBoundingClientRect;

    fixture = TestBed.createComponent(WhiteboardCanvasComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('renders the toolbar with aria-label', () => {
    const toolbar = fixture.nativeElement.querySelector('[role="toolbar"]');
    expect(toolbar).not.toBeNull();
  });

  it('renders all 6 tool buttons', () => {
    const buttons = fixture.nativeElement.querySelectorAll('.wb-toolbar__btn');
    // 6 tools + undo + redo + color + group + ungroup + duplicate + zoomIn + zoomOut + shortcuts
    expect(buttons.length).toBeGreaterThanOrEqual(6);
  });

  it('defaults to select tool', () => {
    const selectBtn = fixture.nativeElement.querySelector('.wb-toolbar__btn--active');
    expect(selectBtn).not.toBeNull();
    expect(selectBtn.getAttribute('aria-pressed')).toBe('true');
  });

  it('marks buttons as aria-pressed correctly', () => {
    component['activeTool'].set('pencil');
    fixture.detectChanges();
    const activeButtons = fixture.nativeElement.querySelectorAll('[aria-pressed="true"]');
    expect(activeButtons.length).toBeGreaterThanOrEqual(1);
  });

  it('12 colour swatches visible when color picker is open', () => {
    component['showColorPicker'].set(true);
    fixture.detectChanges();
    const swatches = fixture.nativeElement.querySelectorAll('.wb-color-option');
    expect(swatches.length).toBe(12);
  });

  it('rejects invalid hex in custom colour input (silently, no error on valid)', () => {
    component['setStrokeColor']('#E91E63');
    expect(component['strokeColor']()).toBe('#E91E63');
    // Invalid input does not change the colour
    component['setStrokeColor']('notacolor');
    expect(component['strokeColor']()).toBe('#E91E63');
  });

  it('opens shortcuts dialog on ? key', () => {
    expect(component['showShortcutDialog']()).toBe(false);
    component['onKeyDown'](new KeyboardEvent('keydown', { key: '?' }));
    expect(component['showShortcutDialog']()).toBe(true);
  });

  it('select all (Ctrl+A) selects every object', () => {
    component['objects'].set([makeRect('r1'), makeRect('r2'), makeStroke('s1')]);
    component['onKeyDown'](new KeyboardEvent('keydown', { key: 'a', ctrlKey: true }));
    expect(component['selectedIds']().size).toBe(3);
  });

  it('delete key removes selected objects', () => {
    component['objects'].set([makeRect('r1'), makeRect('r2')]);
    component['selectedIds'].set(new Set(['r1']));
    component['onKeyDown'](new KeyboardEvent('keydown', { key: 'Delete' }));
    expect(component['objects']().map(o => o.id)).not.toContain('r1');
    expect(component['objects']().map(o => o.id)).toContain('r2');
  });

  it('duplicate (Ctrl+D) creates a copy offset by DUPLICATE_OFFSET', () => {
    const rect = makeRect('r1', 50, 50, 100, 60);
    component['objects'].set([rect]);
    component['selectedIds'].set(new Set(['r1']));
    component['onKeyDown'](new KeyboardEvent('keydown', { key: 'd', ctrlKey: true }));
    const objs = component['objects']();
    expect(objs).toHaveLength(2);
    const copy = objs[1] as ShapeObject;
    expect(copy.x).toBe(66);   // 50 + 16
    expect(copy.y).toBe(66);   // 50 + 16
    expect(copy.id).not.toBe('r1');
  });

  it('Ctrl+C then Ctrl+V pastes without changing original', () => {
    component['objects'].set([makeRect('r1')]);
    component['selectedIds'].set(new Set(['r1']));
    component['onKeyDown'](new KeyboardEvent('keydown', { key: 'c', ctrlKey: true }));
    component['onKeyDown'](new KeyboardEvent('keydown', { key: 'v', ctrlKey: true }));
    expect(component['objects']()).toHaveLength(2);
    expect(component['objects']()[0].id).toBe('r1');
  });

  it('Ctrl+V without prior Ctrl+C is a no-op (no error)', () => {
    component['objects'].set([makeRect('r1')]);
    expect(() => {
      component['onKeyDown'](new KeyboardEvent('keydown', { key: 'v', ctrlKey: true }));
    }).not.toThrow();
    expect(component['objects']()).toHaveLength(1);
  });

  it('group (Ctrl+G) sets the same groupId on selected objects', () => {
    component['objects'].set([makeRect('r1'), makeRect('r2')]);
    component['selectedIds'].set(new Set(['r1', 'r2']));
    component['onKeyDown'](new KeyboardEvent('keydown', { key: 'g', ctrlKey: true }));
    const objs = component['objects']();
    expect(objs[0].groupId).toBeDefined();
    expect(objs[0].groupId).toBe(objs[1].groupId);
  });

  it('ungroup (Ctrl+Shift+G) removes groupId from selected objects', () => {
    component['objects'].set([
      { ...makeRect('r1'), groupId: 'grp-1' },
      { ...makeRect('r2'), groupId: 'grp-1' },
    ]);
    component['selectedIds'].set(new Set(['r1', 'r2']));
    component['onKeyDown'](new KeyboardEvent('keydown', { key: 'g', ctrlKey: true, shiftKey: true }));
    const objs = component['objects']();
    expect(objs[0].groupId).toBeUndefined();
    expect(objs[1].groupId).toBeUndefined();
  });

  it('Ctrl+D with empty selection is a no-op', () => {
    component['objects'].set([makeRect('r1')]);
    component['selectedIds'].set(new Set());
    component['onKeyDown'](new KeyboardEvent('keydown', { key: 'd', ctrlKey: true }));
    expect(component['objects']()).toHaveLength(1);
  });

  it('Ctrl+Z undoes the last action', () => {
    const undoRedo = TestBed.inject(UndoRedoService);
    undoRedo.push([makeRect('r1'), makeRect('r2')]);
    component['objects'].set([makeRect('r1'), makeRect('r2'), makeRect('r3')]);
    component['onUndo']();
    expect(component['objects']()).toHaveLength(2);
  });

  it('Ctrl+Y redoes after undo', () => {
    const undoRedo = TestBed.inject(UndoRedoService);
    const twoRects = [makeRect('r1'), makeRect('r2')];
    undoRedo.push(twoRects);
    component['objects'].set([makeRect('r1'), makeRect('r2'), makeRect('r3')]);
    component['onUndo']();
    component['onRedo']();
    expect(undoRedo.canRedo()).toBe(false);
  });

  it('read-only mode disables toolbar buttons', () => {
    fixture.componentRef.setInput('readOnly', true);
    fixture.detectChanges();
    const disabledBtns = fixture.nativeElement.querySelectorAll('button[disabled]');
    expect(disabledBtns.length).toBeGreaterThan(0);
  });

  it('shows read-only banner when readOnly is true', () => {
    fixture.componentRef.setInput('readOnly', true);
    fixture.detectChanges();
    const banner = fixture.nativeElement.querySelector('.wb-banner--offline');
    expect(banner).not.toBeNull();
  });

  it('canvas has role=application and aria-label', () => {
    const canvas = fixture.nativeElement.querySelector('canvas[role="application"]');
    expect(canvas).not.toBeNull();
  });

  it('canvas has tabindex=0 for keyboard focus', () => {
    const canvas = fixture.nativeElement.querySelector('canvas');
    expect(canvas.getAttribute('tabindex')).toBe('0');
  });

  it('applyRemoteAction with DRAW/shape adds object to canvas', () => {
    const rect = makeRect('remote-1');
    component.applyRemoteAction({ type: 'DRAW', subType: 'shape', payload: rect });
    expect(component['objects']().find(o => o.id === 'remote-1')).toBeDefined();
  });

  it('applyRemoteAction with DRAW/erase removes object', () => {
    component['objects'].set([makeRect('to-erase')]);
    component.applyRemoteAction({ type: 'DRAW', subType: 'erase', payload: { id: 'to-erase' } });
    expect(component['objects']().find(o => o.id === 'to-erase')).toBeUndefined();
  });

  it('smart guides computation does not throw on empty objects', () => {
    component['objects'].set([makeRect('r1')]);
    component['selectedIds'].set(new Set(['r1']));
    expect(() => component['computeGuides'](100, 100)).not.toThrow();
  });

  it('text content is capped at MAX_TEXT_LENGTH (500 chars)', () => {
    component['isEditingText'].set(true);
    component['textEditX'].set(100);
    component['textEditY'].set(100);
    component['editingObjectId'].set(null);
    const longText = 'a'.repeat(600);
    component['commitTextEdit'](longText);
    const textObjs = component['objects']().filter(o => o.kind === 'text');
    expect(textObjs.length).toBeGreaterThan(0);
    expect((textObjs[0] as { content: string }).content).toHaveLength(500);
  });

  it('canGroup is false when only 1 object selected, group button is disabled', () => {
    component['objects'].set([makeRect('r1')]);
    component['selectedIds'].set(new Set(['r1']));
    expect(component['canGroup']()).toBe(false);
    fixture.detectChanges();
    const disabledBtns = fixture.nativeElement.querySelectorAll('button[disabled]');
    expect(disabledBtns.length).toBeGreaterThan(0);
  });

  // ─── Additional keyboard / state tests ─────────────────────────────────────

  it('arrow keys move the selected object', () => {
    const rect = makeRect('r1', 50, 50, 100, 60);
    component['objects'].set([rect]);
    component['selectedIds'].set(new Set(['r1']));
    component['onKeyDown'](new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    const moved = component['objects']().find(o => o.id === 'r1') as ShapeObject;
    expect(moved.x).toBe(51); // +1px
  });

  it('shift+arrow moves by 10px', () => {
    const rect = makeRect('r1', 50, 50, 100, 60);
    component['objects'].set([rect]);
    component['selectedIds'].set(new Set(['r1']));
    component['onKeyDown'](new KeyboardEvent('keydown', { key: 'ArrowDown', shiftKey: true }));
    const moved = component['objects']().find(o => o.id === 'r1') as ShapeObject;
    expect(moved.y).toBe(60); // +10px
  });

  it('Backspace also removes selected objects', () => {
    component['objects'].set([makeRect('r1'), makeRect('r2')]);
    component['selectedIds'].set(new Set(['r1']));
    component['onKeyDown'](new KeyboardEvent('keydown', { key: 'Backspace' }));
    expect(component['objects']().map(o => o.id)).not.toContain('r1');
  });

  it('space bar down sets spaceDown flag, keyUp clears it', () => {
    component['onKeyDown'](new KeyboardEvent('keydown', { key: ' ' }));
    expect(component['spaceDown']).toBe(true);
    component['onKeyUp'](new KeyboardEvent('keyup', { key: ' ' }));
    expect(component['spaceDown']).toBe(false);
  });

  it('toggleMinimap flips showMinimap signal', () => {
    const before = component['showMinimap']();
    component['toggleMinimap']();
    expect(component['showMinimap']()).toBe(!before);
    component['toggleMinimap']();
    expect(component['showMinimap']()).toBe(before);
  });

  it('setTool is a no-op when readOnly', () => {
    fixture.componentRef.setInput('readOnly', true);
    component['setTool']('pencil');
    expect(component['activeTool']()).toBe('select');
  });

  it('setCustomColor applies valid hex', () => {
    component['customHexInput'].set('#3F51B5');
    component['setCustomColor']();
    expect(component['strokeColor']()).toBe('#3F51B5');
    expect(component['customHexError']()).toBe(false);
  });

  it('setCustomColor sets error flag for invalid hex', () => {
    component['customHexInput'].set('notvalid');
    component['setCustomColor']();
    expect(component['customHexError']()).toBe(true);
  });

  it('setCustomColor auto-prepends # when missing', () => {
    component['customHexInput'].set('2196F3');
    component['setCustomColor']();
    expect(component['strokeColor']()).toBe('#2196F3');
  });

  it('cancelTextEdit clears editing state', () => {
    component['isEditingText'].set(true);
    component['editingObjectId'].set('some-id');
    component['cancelTextEdit']();
    expect(component['isEditingText']()).toBe(false);
    expect(component['editingObjectId']()).toBeNull();
  });

  it('commitTextEdit with empty string does not add a text object', () => {
    component['isEditingText'].set(true);
    component['textEditX'].set(100);
    component['textEditY'].set(100);
    component['editingObjectId'].set(null);
    component['commitTextEdit']('   '); // whitespace only
    const textObjs = component['objects']().filter(o => o.kind === 'text');
    expect(textObjs.length).toBe(0);
    expect(component['isEditingText']()).toBe(false);
  });

  it('commitTextEdit updates existing text object by id', () => {
    const textObj = {
      id: 'txt-1', kind: 'text' as const, x: 50, y: 50,
      content: 'old', fontSize: 16,
      strokeColor: '#000', fillColor: 'transparent', lineWidth: 1,
    };
    component['objects'].set([textObj]);
    component['isEditingText'].set(true);
    component['textEditX'].set(50);
    component['textEditY'].set(50);
    component['editingObjectId'].set('txt-1');
    component['commitTextEdit']('new content');
    const updated = component['objects']().find(o => o.id === 'txt-1') as { content: string };
    expect(updated?.content).toBe('new content');
  });

  it('applyRemoteAction with text subType adds/updates text object', () => {
    const textObj = {
      id: 'remote-text', kind: 'text' as const, x: 10, y: 20,
      content: 'hello', fontSize: 16,
      strokeColor: '#000', fillColor: 'transparent', lineWidth: 1,
    };
    component.applyRemoteAction({ type: 'DRAW', subType: 'text', payload: textObj });
    expect(component['objects']().find(o => o.id === 'remote-text')).toBeDefined();
  });

  it('applyRemoteAction with move subType updates positions', () => {
    component['objects'].set([makeRect('r1', 0, 0, 50, 50)]);
    const moved = { ...makeRect('r1', 20, 20, 50, 50) };
    component.applyRemoteAction({ type: 'DRAW', subType: 'move', payload: [moved] });
    const obj = component['objects']().find(o => o.id === 'r1') as ShapeObject;
    expect(obj.x).toBe(20);
  });

  it('applyRemoteAction with unknown type is a no-op', () => {
    component['objects'].set([makeRect('r1')]);
    component.applyRemoteAction({ type: 'DRAW', subType: 'erase', payload: { id: 'nonexistent' } });
    expect(component['objects']()).toHaveLength(1);
  });

  it('zoomIn increases zoom level', () => {
    const before = component['zoom']();
    component['zoomIn']();
    expect(component['zoom']()).toBeGreaterThan(before);
  });

  it('zoomOut decreases zoom level', () => {
    const before = component['zoom']();
    component['zoomOut']();
    expect(component['zoom']()).toBeLessThan(before);
  });

  it('zoom is clamped between 0.1 and 10', () => {
    for (let i = 0; i < 50; i++) component['zoomIn']();
    expect(component['zoom']()).toBeLessThanOrEqual(10);
    for (let i = 0; i < 100; i++) component['zoomOut']();
    expect(component['zoom']()).toBeGreaterThanOrEqual(0.1);
  });

  it('Ctrl+= also triggers zoom in', () => {
    const before = component['zoom']();
    component['onKeyDown'](new KeyboardEvent('keydown', { key: '=', ctrlKey: true }));
    expect(component['zoom']()).toBeGreaterThan(before);
  });

  it('Ctrl+- triggers zoom out', () => {
    const before = component['zoom']();
    component['onKeyDown'](new KeyboardEvent('keydown', { key: '-', ctrlKey: true }));
    expect(component['zoom']()).toBeLessThan(before);
  });

  it('tool shortcut V switches to select', () => {
    component['activeTool'].set('pencil');
    component['onKeyDown'](new KeyboardEvent('keydown', { key: 'v' }));
    expect(component['activeTool']()).toBe('select');
  });

  it('tool shortcut P switches to pencil', () => {
    component['onKeyDown'](new KeyboardEvent('keydown', { key: 'p' }));
    expect(component['activeTool']()).toBe('pencil');
  });

  it('tool shortcut T switches to text', () => {
    component['onKeyDown'](new KeyboardEvent('keydown', { key: 't' }));
    expect(component['activeTool']()).toBe('text');
  });

  it('tool shortcut E switches to erase', () => {
    component['onKeyDown'](new KeyboardEvent('keydown', { key: 'e' }));
    expect(component['activeTool']()).toBe('erase');
  });

  it('tool shortcut R switches to rectangle', () => {
    component['onKeyDown'](new KeyboardEvent('keydown', { key: 'r' }));
    expect(component['activeTool']()).toBe('rectangle');
  });

  it('keyboard shortcuts are ignored when isEditingText is true', () => {
    component['isEditingText'].set(true);
    component['activeTool'].set('select');
    component['onKeyDown'](new KeyboardEvent('keydown', { key: 'p' }));
    expect(component['activeTool']()).toBe('select'); // unchanged
  });

  it('eraseAt removes the hit object and emits erase', () => {
    component['objects'].set([makeRect('r1', 50, 50, 100, 60)]);
    component['eraseAt'](100, 80); // inside rect (50,50)-(150,110)
    expect(component['objects']().find(o => o.id === 'r1')).toBeUndefined();
  });

  it('eraseAt is a no-op when nothing is hit', () => {
    component['objects'].set([makeRect('r1', 50, 50, 100, 60)]);
    component['eraseAt'](0, 0); // far from rect
    expect(component['objects']()).toHaveLength(1);
  });

  it('moveSelected moves grouped objects together', () => {
    const r1 = { ...makeRect('r1', 0, 0, 50, 50), groupId: 'g1' };
    const r2 = { ...makeRect('r2', 60, 0, 50, 50), groupId: 'g1' };
    component['objects'].set([r1, r2]);
    component['selectedIds'].set(new Set(['r1'])); // only select r1, but r2 shares groupId
    component['moveSelected'](10, 10);
    const moved1 = component['objects']().find(o => o.id === 'r1') as ShapeObject;
    const moved2 = component['objects']().find(o => o.id === 'r2') as ShapeObject;
    expect(moved1.x).toBe(10);
    expect(moved2.x).toBe(70); // moved because same group
  });

  it('hasSelection computed is false when no objects selected', () => {
    component['selectedIds'].set(new Set());
    expect(component['hasSelection']()).toBe(false);
  });

  it('hasSelection computed is true when at least one object selected', () => {
    component['objects'].set([makeRect('r1')]);
    component['selectedIds'].set(new Set(['r1']));
    expect(component['hasSelection']()).toBe(true);
  });

  it('canGroup computed is true when 2+ objects selected', () => {
    component['objects'].set([makeRect('r1'), makeRect('r2')]);
    component['selectedIds'].set(new Set(['r1', 'r2']));
    expect(component['canGroup']()).toBe(true);
  });
});

// ─── Additional geometry tests ────────────────────────────────────────────────

describe('getBoundingBox — TextObject', () => {
  it('returns a bbox for a text object', () => {
    const textObj = {
      id: 't1', kind: 'text' as const,
      x: 100, y: 200, content: 'hello', fontSize: 16,
      strokeColor: '#000', fillColor: 'transparent', lineWidth: 1,
    };
    const bb = getBoundingBox(textObj);
    expect(bb.x).toBe(100);
    expect(bb.y).toBe(184); // y - fontSize = 200 - 16
    expect(bb.width).toBeGreaterThan(0);
    expect(bb.height).toBeGreaterThan(0);
  });
});

describe('translateObject — TextObject', () => {
  it('translates text object by dx/dy', () => {
    const textObj = {
      id: 't1', kind: 'text' as const,
      x: 100, y: 200, content: 'hello', fontSize: 16,
      strokeColor: '#000', fillColor: 'transparent', lineWidth: 1,
    };
    const translated = translateObject(textObj, 5, -10) as { x: number; y: number };
    expect(translated.x).toBe(105);
    expect(translated.y).toBe(190);
  });
});

describe('canvas-geometry — strokeBBox min/max branches', () => {
  it('strokeBBox correctly computes min/max with decreasing coords', () => {
    const stroke: StrokeObject = {
      id: 's', kind: 'stroke',
      points: [[30, 40], [10, 20], [20, 30]],
      strokeColor: '#000', fillColor: 'transparent', lineWidth: 2,
    };
    const bb = getBoundingBox(stroke);
    expect(bb.x).toBeLessThanOrEqual(10);
    expect(bb.y).toBeLessThanOrEqual(20);
    expect(bb.width).toBeGreaterThanOrEqual(20); // 30-10
    expect(bb.height).toBeGreaterThanOrEqual(20); // 40-20
  });

  it('strokeBBox handles single-point stroke', () => {
    const stroke: StrokeObject = {
      id: 's', kind: 'stroke',
      points: [[100, 100]],
      strokeColor: '#000', fillColor: 'transparent', lineWidth: 4,
    };
    const bb = getBoundingBox(stroke);
    expect(bb.width).toBe(4); // maxX-minX + pad*2 = 0 + 4 = 4
    expect(bb.height).toBe(4);
  });

  it('hitTest with zero-length segment falls back to distance from point', () => {
    const stroke: StrokeObject = {
      id: 's', kind: 'stroke',
      points: [[50, 50], [50, 50]], // zero-length
      strokeColor: '#000', fillColor: 'transparent', lineWidth: 2,
    };
    expect(hitTest(stroke, 50, 50)).toBe(true);
    expect(hitTest(stroke, 100, 100)).toBe(false);
  });

  it('clampShape normalizes negative dimensions', () => {
    const rect = makeRect('r', 100, 100, -60, -40);
    const clamped = clampShape(rect, 400, 300);
    expect(clamped.width).toBe(60);
    expect(clamped.height).toBe(40);
    expect(clamped.x).toBeGreaterThanOrEqual(0);
    expect(clamped.y).toBeGreaterThanOrEqual(0);
  });
});

// ─── Component private helper tests ──────────────────────────────────────────

describe('WhiteboardCanvasComponent — private helpers & pointer paths', () => {
  let fixture: ComponentFixture<WhiteboardCanvasComponent>;
  let component: WhiteboardCanvasComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [
        WhiteboardCanvasComponent,
        TranslocoTestingModule.forRoot({
          langs: { fr: {}, en: {} },
          translocoConfig: { defaultLang: 'fr', availableLangs: ['fr', 'en'] },
          preloadLangs: true,
        }),
      ],
    }).compileComponents();

    HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue({
      clearRect: vi.fn(), save: vi.fn(), restore: vi.fn(),
      beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(),
      stroke: vi.fn(), fill: vi.fn(), fillText: vi.fn(),
      rect: vi.fn(), ellipse: vi.fn(), strokeRect: vi.fn(),
      fillRect: vi.fn(), setTransform: vi.fn(), setLineDash: vi.fn(),
      scale: vi.fn(),
    }) as unknown as typeof HTMLCanvasElement.prototype.getContext;

    HTMLCanvasElement.prototype.getBoundingClientRect = vi.fn().mockReturnValue({
      left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600,
    }) as unknown as typeof HTMLCanvasElement.prototype.getBoundingClientRect;

    // Pointer capture required by pointer event handlers
    HTMLCanvasElement.prototype.setPointerCapture = vi.fn() as unknown as typeof HTMLCanvasElement.prototype.setPointerCapture;
    HTMLCanvasElement.prototype.releasePointerCapture = vi.fn() as unknown as typeof HTMLCanvasElement.prototype.releasePointerCapture;

    fixture = TestBed.createComponent(WhiteboardCanvasComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('selectByMarquee selects objects fully inside the marquee', () => {
    component['objects'].set([
      makeRect('r1', 10, 10, 80, 40),
      makeRect('r2', 300, 300, 50, 50),
    ]);
    component['marqueeX'] = 0;
    component['marqueeY'] = 0;
    component['marqueeW'] = 200;
    component['marqueeH'] = 100;
    component['selectByMarquee']();
    expect(component['selectedIds']().has('r1')).toBe(true);
    expect(component['selectedIds']().has('r2')).toBe(false);
  });

  it('selectByMarquee works with reversed marquee direction (drag up-left)', () => {
    component['objects'].set([makeRect('r1', 10, 10, 50, 30)]);
    // Marquee drawn from bottom-right to top-left
    component['marqueeX'] = 200;
    component['marqueeY'] = 200;
    component['marqueeW'] = -200;
    component['marqueeH'] = -200;
    component['selectByMarquee']();
    expect(component['selectedIds']().has('r1')).toBe(true);
  });

  it('hitTestHandle returns null when no selection', () => {
    component['selectedIds'].set(new Set());
    expect(component['hitTestHandle'](100, 100)).toBeNull();
  });

  it('hitTestHandle returns null for empty objects', () => {
    component['objects'].set([]);
    component['selectedIds'].set(new Set(['nonexistent']));
    expect(component['hitTestHandle'](100, 100)).toBeNull();
  });

  it('onPointerDown with pencil tool sets isDrawing', () => {
    component['activeTool'].set('pencil');
    const event = new PointerEvent('pointerdown', {
      clientX: 100, clientY: 100, pointerId: 1, bubbles: true,
    });
    component['onPointerDown'](event);
    expect(component['isDrawing']).toBe(true);
  });

  it('onPointerDown with rectangle tool sets isDrawing', () => {
    component['activeTool'].set('rectangle');
    const event = new PointerEvent('pointerdown', {
      clientX: 100, clientY: 100, pointerId: 1, bubbles: true,
    });
    component['onPointerDown'](event);
    expect(component['isDrawing']).toBe(true);
  });

  it('onPointerDown with ellipse tool sets isDrawing', () => {
    component['activeTool'].set('ellipse');
    const event = new PointerEvent('pointerdown', {
      clientX: 100, clientY: 100, pointerId: 1, bubbles: true,
    });
    component['onPointerDown'](event);
    expect(component['isDrawing']).toBe(true);
  });

  it('onPointerDown → onPointerMove → onPointerUp with pencil creates stroke', () => {
    component['activeTool'].set('pencil');
    const opts = { pointerId: 1, bubbles: true };
    component['onPointerDown'](new PointerEvent('pointerdown', { clientX: 10, clientY: 10, ...opts }));
    component['onPointerMove'](new PointerEvent('pointermove', { clientX: 50, clientY: 50, ...opts }));
    component['onPointerMove'](new PointerEvent('pointermove', { clientX: 100, clientY: 100, ...opts }));
    component['onPointerUp'](new PointerEvent('pointerup', { clientX: 100, clientY: 100, ...opts }));
    const strokes = component['objects']().filter(o => o.kind === 'stroke');
    expect(strokes.length).toBe(1);
  });

  it('onPointerDown → onPointerUp with rectangle creates shape when big enough', () => {
    component['activeTool'].set('rectangle');
    const opts = { pointerId: 1, bubbles: true };
    component['onPointerDown'](new PointerEvent('pointerdown', { clientX: 10, clientY: 10, ...opts }));
    component['onPointerMove'](new PointerEvent('pointermove', { clientX: 110, clientY: 110, ...opts }));
    component['onPointerUp'](new PointerEvent('pointerup', { clientX: 110, clientY: 110, ...opts }));
    const shapes = component['objects']().filter(o => o.kind === 'shape');
    expect(shapes.length).toBe(1);
    expect((shapes[0] as ShapeObject).shape).toBe('rectangle');
  });

  it('onPointerDown → onPointerUp with ellipse creates ellipse shape', () => {
    component['activeTool'].set('ellipse');
    const opts = { pointerId: 1, bubbles: true };
    component['onPointerDown'](new PointerEvent('pointerdown', { clientX: 10, clientY: 10, ...opts }));
    component['onPointerMove'](new PointerEvent('pointermove', { clientX: 60, clientY: 60, ...opts }));
    component['onPointerUp'](new PointerEvent('pointerup', { clientX: 60, clientY: 60, ...opts }));
    const shapes = component['objects']().filter(o => o.kind === 'shape');
    expect(shapes.length).toBe(1);
    expect((shapes[0] as ShapeObject).shape).toBe('ellipse');
  });

  it('pointer click on existing object selects it', () => {
    const rect = makeRect('r1', 50, 50, 100, 60);
    component['objects'].set([rect]);
    component['activeTool'].set('select');
    const opts = { pointerId: 1, bubbles: true };
    component['onPointerDown'](new PointerEvent('pointerdown', { clientX: 100, clientY: 80, ...opts }));
    expect(component['selectedIds']().has('r1')).toBe(true);
  });

  it('pointer click on empty canvas clears selection', () => {
    component['objects'].set([makeRect('r1', 50, 50, 50, 50)]);
    component['selectedIds'].set(new Set(['r1']));
    component['activeTool'].set('select');
    const opts = { pointerId: 1, bubbles: true };
    component['onPointerDown'](new PointerEvent('pointerdown', { clientX: 400, clientY: 400, ...opts }));
    expect(component['selectedIds']().size).toBe(0);
  });

  it('shift+click adds object to selection', () => {
    const r1 = makeRect('r1', 10, 10, 50, 50);
    const r2 = makeRect('r2', 100, 10, 50, 50);
    component['objects'].set([r1, r2]);
    component['selectedIds'].set(new Set(['r1']));
    component['activeTool'].set('select');
    const opts = { pointerId: 1, bubbles: true, shiftKey: true };
    component['onPointerDown'](new PointerEvent('pointerdown', { clientX: 130, clientY: 35, ...opts }));
    expect(component['selectedIds']().has('r1')).toBe(true);
    expect(component['selectedIds']().has('r2')).toBe(true);
  });

  it('pointer erase removes object under cursor', () => {
    component['objects'].set([makeRect('r1', 50, 50, 100, 60)]);
    component['activeTool'].set('erase');
    const opts = { pointerId: 1, bubbles: true };
    component['onPointerDown'](new PointerEvent('pointerdown', { clientX: 100, clientY: 80, ...opts }));
    expect(component['objects']()).toHaveLength(0);
  });

  it('readOnly blocks all pointer events', () => {
    fixture.componentRef.setInput('readOnly', true);
    component['activeTool'].set('pencil');
    const opts = { pointerId: 1, bubbles: true };
    component['onPointerDown'](new PointerEvent('pointerdown', { clientX: 100, clientY: 100, ...opts }));
    expect(component['isDrawing']).toBe(false);
  });

  it('onWheel with ctrlKey zooms in', () => {
    const before = component['zoom']();
    const wheelEvent = new WheelEvent('wheel', { deltaY: -100, ctrlKey: true });
    component['onWheel'](wheelEvent);
    expect(component['zoom']()).toBeGreaterThan(before);
  });

  it('onWheel without ctrlKey does nothing', () => {
    const before = component['zoom']();
    component['onWheel'](new WheelEvent('wheel', { deltaY: -100, ctrlKey: false }));
    expect(component['zoom']()).toBe(before);
  });

  it('clicking near a resize handle sets resizingHandle', () => {
    const rect = makeRect('r1', 50, 50, 100, 60);
    component['objects'].set([rect]);
    component['selectedIds'].set(new Set(['r1']));
    component['activeTool'].set('select');
    // Top-left handle: hx=46, hy=46 (see drawSelectionHandles/hitTestHandle)
    const opts = { pointerId: 1, bubbles: true };
    component['onPointerDown'](new PointerEvent('pointerdown', { clientX: 46, clientY: 46, ...opts }));
    // The handle was hit — resizingHandle is set
    expect(component['resizingHandle']).not.toBeNull();
  });

  it('dragging a selected object triggers moveSelected', () => {
    const rect = makeRect('r1', 50, 50, 100, 60);
    component['objects'].set([rect]);
    component['selectedIds'].set(new Set(['r1']));
    component['activeTool'].set('select');
    const opts = { pointerId: 1, bubbles: true };
    // Click inside object → drag starts
    component['onPointerDown'](new PointerEvent('pointerdown', { clientX: 100, clientY: 80, ...opts }));
    expect(component['isDragging']).toBe(true);
    component['onPointerMove'](new PointerEvent('pointermove', { clientX: 110, clientY: 80, ...opts }));
    component['onPointerUp'](new PointerEvent('pointerup', { clientX: 110, clientY: 80, ...opts }));
    expect(component['isDragging']).toBe(false);
  });

  it('marquee selection flow (pointer down on empty → drag → up)', () => {
    const rect = makeRect('r1', 50, 50, 100, 60);
    component['objects'].set([rect]);
    component['activeTool'].set('select');
    const opts = { pointerId: 1, bubbles: true };
    // Click outside any object → starts marquee
    component['onPointerDown'](new PointerEvent('pointerdown', { clientX: 0, clientY: 0, ...opts }));
    expect(component['isMarquee']).toBe(true);
    component['onPointerMove'](new PointerEvent('pointermove', { clientX: 200, clientY: 200, ...opts }));
    component['onPointerUp'](new PointerEvent('pointerup', { clientX: 200, clientY: 200, ...opts }));
    // rect at (50,50) is within (0,0)-(200,200) marquee → selected
    expect(component['selectedIds']().has('r1')).toBe(true);
  });

  it('render() does not throw with objects and selection', () => {
    component['objects'].set([makeRect('r1'), makeStroke('s1'), {
      id: 't1', kind: 'text', x: 10, y: 20, content: 'hi', fontSize: 16,
      strokeColor: '#000', fillColor: 'transparent', lineWidth: 1,
    }]);
    component['selectedIds'].set(new Set(['r1']));
    expect(() => component['render']()).not.toThrow();
  });

  it('render() with in-progress stroke does not throw', () => {
    component['activeTool'].set('pencil');
    component['isDrawing'] = true;
    component['currentStroke'] = [[10, 10], [20, 20]];
    expect(() => component['render']()).not.toThrow();
  });

  it('render() with in-progress shape does not throw', () => {
    component['isDrawing'] = true;
    component['currentShape'] = { kind: 'shape', shape: 'rectangle', x: 10, y: 10, width: 50, height: 50 };
    expect(() => component['render']()).not.toThrow();
  });

  it('render() with smart guides does not throw', () => {
    component['guides'] = { x: 100, y: 50 };
    expect(() => component['render']()).not.toThrow();
  });

  it('renderMinimap() does not throw', () => {
    component['objects'].set([makeRect('r1')]);
    expect(() => component['renderMinimap']()).not.toThrow();
  });
});
