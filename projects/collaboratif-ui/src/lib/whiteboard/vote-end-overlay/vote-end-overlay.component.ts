import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  OnInit,
  output,
  signal,
} from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';

/** Seconds shown before results are revealed automatically. */
const COUNTDOWN_START = 15;

/**
 * Full-screen "vote ended" overlay for the whiteboard vote (F08.x).
 *
 * Shown when a vote closes. Runs a local countdown and emits
 * {@link VoteEndOverlayComponent.showResults} either when the countdown
 * reaches zero or as soon as the user clicks the overlay / activates the
 * "show results" button. The host owns the actual results transition.
 *
 * WIP: backend timer/vote actions not implemented in collaboratif-core yet —
 * the countdown is purely client-side and no vote tally is fetched here; the
 * component only signals the host that results should be displayed.
 */
@Component({
  selector: 'wb-vote-end-overlay',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslocoPipe],
  templateUrl: './vote-end-overlay.component.html',
  styleUrl: './vote-end-overlay.component.scss',
})
export class VoteEndOverlayComponent implements OnInit, OnDestroy {
  /** Emitted when results should be revealed (countdown end or user action). */
  readonly showResults = output<void>();

  /** Remaining seconds before results are revealed automatically. */
  protected readonly countdown = signal(COUNTDOWN_START);

  private intervalId: ReturnType<typeof setInterval> | null = null;
  private resolved = false;

  ngOnInit(): void {
    this.intervalId = setInterval(() => {
      const next = this.countdown() - 1;
      this.countdown.set(next);
      if (next <= 0) {
        this.reveal();
      }
    }, 1000);
  }

  ngOnDestroy(): void {
    this.clearTimer();
  }

  /** Reveal results, guarding against a double emit and stopping the timer. */
  protected reveal(): void {
    if (this.resolved) {
      return;
    }
    this.resolved = true;
    this.clearTimer();
    this.showResults.emit();
  }

  private clearTimer(): void {
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }
}
