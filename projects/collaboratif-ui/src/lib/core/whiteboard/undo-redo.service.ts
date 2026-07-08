import { Injectable, signal } from '@angular/core';
import { CanvasObject, UNDO_STACK_LIMIT } from '../../whiteboard/canvas/model/canvas.model';

/** An undoable snapshot of the canvas object list. */
interface Snapshot {
  objects: CanvasObject[];
  /**
   * Client-generated identifier of the action this snapshot is a restore point for
   * (US08.3.3 AC5). Generated once in {@link push}, at the same granularity as a
   * `DRAW` action (one `push` per undoable action) — never per keystroke/point.
   *
   * The wire contract (`pivot-collaboratif-core`, `CanvasActionMessage`) documents
   * `UNDO: { eventId }` without specifying who mints it. The server never echoes a
   * correlation id back to the client for `DRAW` broadcasts (`CanvasActionService
   * #handleDraw` rebroadcasts the client's own `data` unchanged), so there is no
   * server-issued id available to reuse here. This id is therefore minted client-side
   * purely to let {@link WhiteboardSyncService.publish} identify, in the outgoing
   * `UNDO` message, *which* locally-undone action the broadcast corresponds to — it is
   * not required to match any server-side persisted event id, and the server does not
   * validate it (`CanvasActionService#handleUndo` only rebroadcasts).
   */
  eventId: string;
}

/** Result of a successful {@link UndoRedoService.undo} call. */
export interface UndoResult {
  /** Canvas object list to restore (the state before the undone action). */
  objects: CanvasObject[];
  /** Id of the action that was undone — relayed in the `UNDO { eventId }` STOMP message. */
  eventId: string;
}

/**
 * Manages the per-user undo/redo stack for the whiteboard canvas (US08.3.3).
 *
 * Each entry in the stack is a full snapshot of the canvas object list, tagged with a
 * client-generated {@link Snapshot.eventId}. The stack is bounded at
 * {@link UNDO_STACK_LIMIT} entries (50). On WebSocket disconnect the stack is reset via
 * {@link reset}.
 *
 * Ctrl+Z / Ctrl+Y keyboard shortcuts and toolbar buttons are wired in
 * {@link WhiteboardCanvasComponent} and call {@link undo} / {@link redo}. A successful
 * {@link undo} additionally carries the `eventId` that `WhiteboardCanvasComponent`
 * forwards to `WhiteboardBoardComponent`, which relays it over STOMP via
 * `WhiteboardSyncService.publish('UNDO', { eventId })` (US08.3.3 AC5) — this service
 * stays STOMP-unaware by design, matching the layering already used for `DRAW` actions.
 */
@Injectable({ providedIn: 'root' })
export class UndoRedoService {
  private undoStack: Snapshot[] = [];
  private redoStack: Snapshot[] = [];

  readonly canUndo = signal(false);
  readonly canRedo = signal(false);

  /**
   * Pushes a new snapshot onto the undo stack, tagged with a freshly minted
   * {@link Snapshot.eventId}. Clears the redo stack (any action after undo breaks the
   * redo chain).
   */
  push(objects: CanvasObject[]): void {
    this.undoStack.push({ objects: [...objects], eventId: crypto.randomUUID() });
    if (this.undoStack.length > UNDO_STACK_LIMIT) {
      this.undoStack.shift();
    }
    this.redoStack = [];
    this.updateSignals();
  }

  /**
   * Pops the most recent snapshot and returns the previous state plus the id of the
   * action that was undone. Returns null if the undo stack is empty.
   */
  undo(current: CanvasObject[]): UndoResult | null {
    const snapshot = this.undoStack.pop();
    if (!snapshot) return null;
    this.redoStack.push({ objects: [...current], eventId: snapshot.eventId });
    this.updateSignals();
    return { objects: snapshot.objects, eventId: snapshot.eventId };
  }

  /**
   * Re-applies the most recently undone snapshot. Returns null if the redo stack is
   * empty. No STOMP message is sent on redo — the wire contract only defines `UNDO`
   * (US08.3.3 AC5 scopes broadcast to undo only; redo is a purely local operation).
   */
  redo(current: CanvasObject[]): CanvasObject[] | null {
    const snapshot = this.redoStack.pop();
    if (!snapshot) return null;
    this.undoStack.push({ objects: [...current], eventId: snapshot.eventId });
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
