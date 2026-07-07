import { Injectable, signal } from '@angular/core';
import { CanvasObject, UNDO_STACK_LIMIT } from '../../whiteboard/canvas/model/canvas.model';

/** An undoable snapshot of the canvas object list. */
interface Snapshot {
  objects: CanvasObject[];
}

/**
 * Manages the per-user undo/redo stack for the whiteboard canvas (US08.3.3).
 *
 * Each entry in the stack is a full snapshot of the canvas object list.
 * The stack is bounded at {@link UNDO_STACK_LIMIT} entries (50). On WebSocket
 * disconnect the stack is reset via {@link reset}.
 *
 * Ctrl+Z / Ctrl+Y keyboard shortcuts and toolbar buttons are wired in
 * {@link WhiteboardCanvasComponent} and call {@link undo} / {@link redo}.
 */
@Injectable({ providedIn: 'root' })
export class UndoRedoService {
  private undoStack: Snapshot[] = [];
  private redoStack: Snapshot[] = [];

  readonly canUndo = signal(false);
  readonly canRedo = signal(false);

  /**
   * Pushes a new snapshot onto the undo stack.
   * Clears the redo stack (any action after undo breaks the redo chain).
   */
  push(objects: CanvasObject[]): void {
    this.undoStack.push({ objects: [...objects] });
    if (this.undoStack.length > UNDO_STACK_LIMIT) {
      this.undoStack.shift();
    }
    this.redoStack = [];
    this.updateSignals();
  }

  /**
   * Pops the most recent snapshot and returns the previous state.
   * Returns null if the undo stack is empty.
   */
  undo(current: CanvasObject[]): CanvasObject[] | null {
    const snapshot = this.undoStack.pop();
    if (!snapshot) return null;
    this.redoStack.push({ objects: [...current] });
    this.updateSignals();
    return snapshot.objects;
  }

  /**
   * Re-applies the most recently undone snapshot.
   * Returns null if the redo stack is empty.
   */
  redo(current: CanvasObject[]): CanvasObject[] | null {
    const snapshot = this.redoStack.pop();
    if (!snapshot) return null;
    this.undoStack.push({ objects: [...current] });
    this.updateSignals();
    return snapshot.objects;
  }

  /** Clears both stacks — call on WebSocket disconnect (US08.3.2b). */
  reset(): void {
    this.undoStack = [];
    this.redoStack = [];
    this.updateSignals();
  }

  private updateSignals(): void {
    this.canUndo.set(this.undoStack.length > 0);
    this.canRedo.set(this.redoStack.length > 0);
  }
}
