import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { Subscription } from 'rxjs';
import { ParticipantInfo, WhiteboardSyncService } from '../../core/whiteboard/whiteboard-sync.service';

/**
 * Maximum number of avatars rendered before the rest collapse into a single "+N" overflow
 * badge (US08.5.1 AC "5 premiers avatars visibles, reste en +N").
 */
const MAX_VISIBLE_AVATARS = 5;

/** A participant entry ready for template rendering — adds derived initials + translated labels. */
interface DisplayParticipant {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  color: string;
  initials: string;
  ariaLabel: string;
}

/**
 * Panel listing the participants currently connected to a whiteboard, rendered above the
 * canvas (US08.5.1). Complements — never duplicates — `WhiteboardPresenceComponent`
 * (US08.3.2c), which renders the *cursor overlay* on the canvas itself: that component is a
 * decorative, `aria-hidden` SVG layer with no participant list of its own; this component is
 * the only one that renders avatars/initials, the "+N" overflow, and the accessible
 * participant list (see that component's TSDoc, "Hors périmètre" in the backlog file, and the
 * Gate 1 chevauchement note in `sprint-5.md` for the explicit split between the two).
 *
 * ## Shared source of truth — `WhiteboardSyncService.participantsUpdates$`
 * Reuses the exact same `Observable<ParticipantInfo[]>` already exposed by
 * {@link WhiteboardSyncService} for US08.3.2c rather than opening a second STOMP
 * subscription to the same `/topic/whiteboard/{boardId}/presence` subtopic — that service
 * already owns the single STOMP client and the single subscription per board; a second
 * subscription here would be redundant plumbing for no behavioural benefit (RxJS `Subject`
 * multicasts to every subscriber already). Like `WhiteboardPresenceComponent`, this component
 * injects {@link WhiteboardSyncService} directly rather than routing the list through
 * `WhiteboardBoardComponent` as extra glue — this is presence-only UI, not part of the
 * transport-agnostic canvas contract (`WhiteboardCanvasComponent`).
 *
 * ## Colour — never recomputed client-side
 * `color` is rendered as-is from `ParticipantInfo.color` (server-assigned at JOIN, see
 * `WhiteboardSyncService` class TSDoc) — the same field `WhiteboardPresenceComponent` uses for
 * the matching cursor, so a participant's avatar and cursor are always visually consistent
 * (AC "couleur cohérente entre son curseur et son avatar").
 *
 * ## Security — no data beyond the wire contract
 * Only `userId`/`displayName`/`avatarUrl`/`color`/`role` ever reach the template — the same
 * fields `WhiteboardSyncService.isParticipantInfo` already validates the payload against
 * (US08.5.1 security AC: "n'expose que userId, displayName, role, color — jamais l'email").
 * `displayName` is rendered via Angular interpolation (`{{ }}`) only, never `[innerHTML]`.
 */
@Component({
  selector: 'app-presence-panel',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslocoPipe],
  templateUrl: './presence-panel.component.html',
  styleUrl: './presence-panel.component.scss',
})
export class PresencePanelComponent implements OnInit, OnDestroy {
  private readonly sync = inject(WhiteboardSyncService);
  private readonly transloco = inject(TranslocoService);

  private readonly participants = signal<ParticipantInfo[]>([]);

  /** Total number of currently connected participants (all of them, not just the visible ones). */
  protected readonly participantCount = computed(() => this.participants().length);

  protected readonly hasParticipants = computed(() => this.participants().length > 0);

  /** The first {@link MAX_VISIBLE_AVATARS} participants, ready for template rendering. */
  protected readonly visibleParticipants = computed<DisplayParticipant[]>(() =>
    this.participants()
      .slice(0, MAX_VISIBLE_AVATARS)
      .map(participant => this.toDisplayParticipant(participant)),
  );

  /** Number of participants collapsed into the "+N" overflow badge (0 when 5 or fewer). */
  protected readonly overflowCount = computed(() =>
    Math.max(0, this.participants().length - MAX_VISIBLE_AVATARS),
  );

  /** Display names of the overflowed participants, in order — used by the tooltip + aria-label. */
  protected readonly overflowNames = computed(() =>
    this.participants()
      .slice(MAX_VISIBLE_AVATARS)
      .map(participant => participant.displayName),
  );

  /** Comma-separated overflow names, for the native hover tooltip (AC "tooltip listant les noms"). */
  protected readonly overflowTooltip = computed(() => this.overflowNames().join(', '));

  /**
   * `aria-label` for the "+N" badge (AC "Et [N] autres participants : [liste des noms]"). Only
   * ever read from the template while {@link overflowCount} is greater than zero (the badge's
   * `@if` block) — no need for a defensive zero-count branch here.
   */
  protected readonly overflowAriaLabel = computed(() =>
    this.transloco.translate('whiteboard.presence.overflowAriaLabel', {
      count: this.overflowCount(),
      names: this.overflowNames().join(', '),
    }),
  );

  private participantsSubscription?: Subscription;

  ngOnInit(): void {
    this.participantsSubscription = this.sync.participantsUpdates$.subscribe(list => this.participants.set(list));
  }

  ngOnDestroy(): void {
    this.participantsSubscription?.unsubscribe();
  }

  private toDisplayParticipant(participant: ParticipantInfo): DisplayParticipant {
    const roleLabel = this.roleLabel(participant.role);
    return {
      userId: participant.userId,
      displayName: participant.displayName,
      avatarUrl: participant.avatarUrl,
      color: participant.color,
      initials: this.computeInitials(participant.displayName),
      ariaLabel: this.transloco.translate('whiteboard.presence.avatarAriaLabel', {
        name: participant.displayName,
        role: roleLabel,
      }),
    };
  }

  /**
   * Translates a wire-contract role (`OWNER`/`EDITOR`/`VIEWER`, US08.5.1 backend) into its
   * French/English label. Case-insensitive on the incoming value — the presence wire contract
   * uses upper-case roles (`ParticipantInfo.role`), unlike the unrelated lower-case
   * `Board['role']` used by `whiteboard.board.list.role.*` (US08.1.3) — kept as a distinct
   * `whiteboard.presence.role.*` namespace per this US's AC rather than reusing that one.
   */
  private roleLabel(role: string): string {
    return this.transloco.translate(`whiteboard.presence.role.${role.toLowerCase()}`);
  }

  /**
   * Derives up to two uppercase initials from a display name — first letter of the first and
   * last "word", or the first two letters when there is a single word. Purely a visual
   * fallback for participants without an `avatarUrl`; never used for the accessible name
   * (that stays the full {@link DisplayParticipant.ariaLabel}).
   */
  private computeInitials(displayName: string): string {
    const trimmed = displayName.trim();
    if (!trimmed) {
      return '?';
    }
    const parts = trimmed.split(/\s+/);
    if (parts.length === 1) {
      return parts[0].slice(0, 2).toUpperCase();
    }
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
}
