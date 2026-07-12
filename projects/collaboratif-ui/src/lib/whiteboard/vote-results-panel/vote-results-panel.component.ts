import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { Card, VoteSession } from '../model/board.types';
import { cardDisplayText } from '../model/card-format';

/** A single card's ranked vote result, precomputed for the template. */
interface RankedResult {
  /** The board card that received votes. */
  readonly card: Card;
  /** Number of votes cast for the card in this session. */
  readonly count: number;
  /** Human-readable display text of the card (unwrapped from TEXT/LABEL JSON). */
  readonly text: string;
  /** 1-based rank in the descending tally. */
  readonly rank: number;
  /** Bar width as a percentage of the top card's count (0–100). */
  readonly percent: number;
  /** True for the top-ranked card (podium highlight). */
  readonly isWinner: boolean;
}

/**
 * Read-only panel showing the tally of a dot-voting session over the board's
 * cards (ported from the PouetPouet reference `board/vote-results-panel.tsx`).
 *
 * Votes in {@link VoteSession.votes} are tallied per card, ranked descending,
 * and rendered as an accessible list of proportional bars with the top card
 * highlighted as the winner. When the current user owns the board and the
 * session is still `ACTIVE`, a control emits {@link stopVote}; a close control
 * emits {@link close}. The empty case (no votes) is handled explicitly.
 *
 * WIP: vote backend not implemented in collaboratif-core yet — this component
 * renders a {@link VoteSession} supplied by its host; wiring to a live vote API
 * is deferred until the backend exposes it.
 */
@Component({
  selector: 'wb-vote-results-panel',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslocoPipe],
  templateUrl: './vote-results-panel.component.html',
  styleUrl: './vote-results-panel.component.scss',
})
export class VoteResultsPanelComponent {
  /** The vote session whose results are displayed. */
  readonly session = input.required<VoteSession>();

  /** The board's cards, used to resolve display text and colors for votes. */
  readonly cards = input.required<Card[]>();

  /** Whether the current user owns the board (gates the stop-vote control). */
  readonly isOwner = input<boolean>(false);

  /** Emitted when the owner requests that the active vote be stopped. */
  readonly stopVote = output<void>();

  /** Emitted when the user closes the panel. */
  readonly close = output<void>();

  /** Cards ranked by descending vote count, with bar percentages precomputed. */
  protected readonly results = computed<RankedResult[]>(() => {
    const { votes } = this.session();
    const cards = this.cards();

    const counts = new Map<string, number>();
    for (const vote of votes) {
      counts.set(vote.cardId, (counts.get(vote.cardId) ?? 0) + 1);
    }

    const ranked = cards
      .filter(card => counts.has(card.id))
      .map(card => ({ card, count: counts.get(card.id) ?? 0 }))
      .sort((a, b) => b.count - a.count);

    const maxCount = ranked[0]?.count ?? 0;

    return ranked.map((entry, index) => ({
      card: entry.card,
      count: entry.count,
      text: cardDisplayText(entry.card),
      rank: index + 1,
      percent: maxCount > 0 ? Math.round((entry.count / maxCount) * 100) : 0,
      isWinner: index === 0,
    }));
  });

  /** Total number of votes cast in the session. */
  protected readonly totalVotes = computed<number>(() => this.session().votes.length);

  /** Number of distinct participants who took part in the session. */
  protected readonly voterCount = computed<number>(() => this.session().voterIds.length);

  /** Highest vote count reached by any single card. */
  protected readonly maxVotes = computed<number>(() => this.results()[0]?.count ?? 0);

  /** Whether the owner may still stop the vote (session is active). */
  protected readonly canStopVote = computed<boolean>(
    () => this.isOwner() && this.session().status === 'ACTIVE',
  );

  /** Emits the stop-vote request to the host. */
  protected onStopVote(): void {
    this.stopVote.emit();
  }

  /** Emits the close request to the host. */
  protected onClose(): void {
    this.close.emit();
  }
}
