import { ChangeDetectionStrategy, Component, ElementRef, HostListener, inject, output, signal } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';

/** Upper bound on votes per person, mirroring the backend's {@code MAX_VOTES_PER_PERSON}. */
export const MAX_VOTES_PER_PERSON = 10;

/** Configuration emitted when a facilitator starts a dot-vote (US08.12.2). */
export interface VoteConfig {
  votesPerPerson: number;
  timerSeconds: number | null;
}

/**
 * Owner/editor dialog to configure and start a dot-vote over the board's cards (US08.12.2).
 *
 * Purely presentational: it emits {@link start} with the chosen budget and optional timer, or
 * {@link close}. The host relays {@code start} to {@code BoardStore.startVote(...)}, which
 * broadcasts {@code vote:start} over STOMP. The eligible-voter whitelist is left to the backend
 * (an empty {@code voterIds} means "anyone with board access", enforced by the per-person quota).
 *
 * `role="dialog" aria-modal="true"` with Escape-to-close.
 */
@Component({
  selector: 'wb-vote-config-dialog',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslocoPipe],
  templateUrl: './vote-config-dialog.component.html',
  styleUrl: './vote-config-dialog.component.scss',
})
export class VoteConfigDialogComponent {
  /** Emits the chosen vote configuration. */
  readonly start = output<VoteConfig>();
  /** Emits when the dialog is dismissed without starting. */
  readonly close = output<void>();

  private readonly host = inject(ElementRef<HTMLElement>);

  protected readonly maxVotes = MAX_VOTES_PER_PERSON;
  protected readonly votesPerPerson = signal(3);
  protected readonly withTimer = signal(false);
  protected readonly timerMinutes = signal(2);

  protected decVotes(): void {
    this.votesPerPerson.update((v) => Math.max(1, v - 1));
  }

  protected incVotes(): void {
    this.votesPerPerson.update((v) => Math.min(MAX_VOTES_PER_PERSON, v + 1));
  }

  protected onToggleTimer(event: Event): void {
    this.withTimer.set((event.target as HTMLInputElement).checked);
  }

  protected onTimerMinutesInput(event: Event): void {
    const n = Math.trunc(Number((event.target as HTMLInputElement).value));
    this.timerMinutes.set(Number.isFinite(n) ? Math.min(60, Math.max(1, n)) : 1);
  }

  protected startVote(): void {
    this.start.emit({
      votesPerPerson: this.votesPerPerson(),
      timerSeconds: this.withTimer() ? this.timerMinutes() * 60 : null,
    });
  }

  protected onClose(): void {
    this.close.emit();
  }

  @HostListener('keydown.escape', ['$event'])
  protected onEscape(event: Event): void {
    event.preventDefault();
    this.onClose();
  }
}
