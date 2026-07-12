import { ChangeDetectionStrategy, Component, output } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';

/**
 * Full-screen "time's up" overlay for the whiteboard timer (F08.x).
 *
 * Displayed when a facilitation timer reaches zero. The overlay is purely
 * presentational and dismissible locally: any click (or activating the
 * dismiss button) emits {@link TimerOverlayComponent.dismiss}. The host is
 * responsible for actually removing the overlay from the DOM.
 *
 * WIP: backend timer/vote actions not implemented in collaboratif-core yet —
 * this component only surfaces the local "time elapsed" state and delegates
 * dismissal to its host; it does not talk to the backend.
 */
@Component({
  selector: 'wb-timer-overlay',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslocoPipe],
  templateUrl: './timer-overlay.component.html',
  styleUrl: './timer-overlay.component.scss',
})
export class TimerOverlayComponent {
  /** Emitted when the user dismisses the overlay (click, button or Escape). */
  readonly dismiss = output<void>();

  /** Emit the dismiss event so the host can tear the overlay down. */
  protected onDismiss(): void {
    this.dismiss.emit();
  }
}
