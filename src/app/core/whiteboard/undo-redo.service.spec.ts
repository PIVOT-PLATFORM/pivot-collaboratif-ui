import { TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach } from 'vitest';
import { UndoRedoService } from './undo-redo.service';
import { ShapeObject, UNDO_STACK_LIMIT } from '../../whiteboard/canvas/model/canvas.model';

function makeRect(id = 'rect-1', x = 0): ShapeObject {
  return {
    id,
    kind: 'shape',
    shape: 'rectangle',
    x, y: 0, width: 10, height: 10,
    strokeColor: '#E91E63',
    fillColor: 'transparent',
    lineWidth: 1,
  };
}

describe('UndoRedoService (US08.3.3)', () => {
  let service: UndoRedoService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(UndoRedoService);
  });

  // ── Initial state ──

  it('starts with both stacks empty (canUndo/canRedo false)', () => {
    expect(service.canUndo()).toBe(false);
    expect(service.canRedo()).toBe(false);
  });

  // ── push() ──

  it('push() makes canUndo true and does not affect canRedo', () => {
    service.push([makeRect('r1')]);
    expect(service.canUndo()).toBe(true);
    expect(service.canRedo()).toBe(false);
  });

  it('push() clears the redo stack (breaks the redo chain)', () => {
    service.push([makeRect('r1')]);
    const afterUndo = service.undo([makeRect('r1'), makeRect('r2')]);
    expect(afterUndo).not.toBeNull();
    expect(service.canRedo()).toBe(true);

    service.push([makeRect('r3')]);
    expect(service.canRedo()).toBe(false);
  });

  it('push() does not mutate the array passed in (defensive copy)', () => {
    const objects = [makeRect('r1')];
    service.push(objects);
    objects.push(makeRect('r2'));
    const result = service.undo([makeRect('r1'), makeRect('r2')]);
    expect(result?.objects).toHaveLength(1);
  });

  // ── undo() ──

  it('undo() returns null when the undo stack is empty', () => {
    expect(service.undo([makeRect('r1')])).toBeNull();
  });

  it('undo() returns the pre-action snapshot and a non-empty eventId', () => {
    service.push([makeRect('r1')]);
    const result = service.undo([makeRect('r1'), makeRect('r2')]);
    expect(result).not.toBeNull();
    expect(result?.objects).toEqual([makeRect('r1')]);
    expect(typeof result?.eventId).toBe('string');
    expect(result?.eventId.length).toBeGreaterThan(0);
  });

  it('undo() generates a distinct eventId per pushed action', () => {
    service.push([makeRect('r1')]);
    service.push([makeRect('r1'), makeRect('r2')]);
    const first = service.undo([makeRect('r1'), makeRect('r2'), makeRect('r3')]);
    const second = service.undo(first!.objects);
    expect(first?.eventId).not.toBe(second?.eventId);
  });

  it('undo() moves the popped snapshot to the redo stack and updates signals', () => {
    service.push([makeRect('r1')]);
    service.undo([makeRect('r1'), makeRect('r2')]);
    expect(service.canUndo()).toBe(false);
    expect(service.canRedo()).toBe(true);
  });

  it('multiple undo() calls unwind the stack in LIFO order', () => {
    service.push([]);
    service.push([makeRect('a')]);
    const step1 = service.undo([makeRect('a'), makeRect('b')]);
    expect(step1?.objects).toEqual([makeRect('a')]);
    const step2 = service.undo(step1!.objects);
    expect(step2?.objects).toEqual([]);
    expect(service.undo([])).toBeNull();
  });

  // ── redo() ──

  it('redo() returns null when the redo stack is empty', () => {
    expect(service.redo([makeRect('r1')])).toBeNull();
  });

  it('redo() restores the undone snapshot and updates signals', () => {
    service.push([makeRect('r1')]);
    const undone = service.undo([makeRect('r1'), makeRect('r2')]);
    const redone = service.redo(undone!.objects);
    expect(redone).toEqual([makeRect('r1'), makeRect('r2')]);
    expect(service.canRedo()).toBe(false);
    expect(service.canUndo()).toBe(true);
  });

  it('redo() does not emit a STOMP-relevant eventId payload (local-only, redo has no wire contract)', () => {
    service.push([makeRect('r1')]);
    const undone = service.undo([makeRect('r1'), makeRect('r2')]);
    const redone = service.redo(undone!.objects);
    // redo() returns a plain CanvasObject[] — no eventId field to relay.
    expect(redone).not.toHaveProperty('eventId');
  });

  it('undo after redo re-uses the same eventId lineage (re-undoing the same action)', () => {
    service.push([makeRect('r1')]);
    const firstUndo = service.undo([makeRect('r1'), makeRect('r2')]);
    service.redo(firstUndo!.objects);
    const secondUndo = service.undo([makeRect('r1'), makeRect('r2')]);
    expect(secondUndo?.eventId).toBe(firstUndo?.eventId);
  });

  // ── Stack limit (AC4 — 50 operations) ──

  it(`caps the undo stack at ${UNDO_STACK_LIMIT} entries, dropping the oldest`, () => {
    for (let i = 0; i < UNDO_STACK_LIMIT + 5; i++) {
      service.push([makeRect(`r${i}`)]);
    }
    let popped = 0;
    let current: unknown[] = [makeRect('final')];
    while (true) {
      const result = service.undo(current as never);
      if (!result) break;
      current = result.objects;
      popped++;
    }
    expect(popped).toBe(UNDO_STACK_LIMIT);
  });

  // ── reset() (AC6 — reset on WebSocket disconnect) ──

  it('reset() clears both stacks and both signals', () => {
    service.push([makeRect('r1')]);
    service.undo([makeRect('r1'), makeRect('r2')]);
    expect(service.canRedo()).toBe(true);

    service.reset();

    expect(service.canUndo()).toBe(false);
    expect(service.canRedo()).toBe(false);
    expect(service.undo([makeRect('x')])).toBeNull();
    expect(service.redo([makeRect('x')])).toBeNull();
  });

  it('reset() is safe to call on an already-empty service', () => {
    expect(() => service.reset()).not.toThrow();
    expect(service.canUndo()).toBe(false);
  });
});
