import { ChangeDetectionStrategy, Component, EventEmitter, Output } from '@angular/core';

/** One facilitation activity offered by the Klaxoon-style picker. */
export interface WbActivity {
  readonly id: string;
  readonly name: string;
  readonly desc: string;
  readonly glyph: string;
  /** Semantic colour family (maps to a token pair in the SCSS). */
  readonly kind: 'brand' | 'info' | 'success' | 'warning' | 'error' | 'neutral';
}

const ACTIVITIES: readonly WbActivity[] = [
  { id: 'brainstorming', name: 'Brainstorming', desc: 'Générez des idées en équipe avec des stickies', glyph: 'B', kind: 'brand' },
  { id: 'poll', name: 'Sondage', desc: 'Posez une question, votez en direct', glyph: 'S', kind: 'info' },
  { id: 'dotvote', name: 'Vote à points', desc: 'Priorisez des idées par vote pondéré', glyph: 'V', kind: 'success' },
  { id: 'icebreaker', name: 'Icebreaker', desc: 'Lancez la session avec une question légère', glyph: 'I', kind: 'warning' },
  { id: 'quiz', name: 'Quiz', desc: "Testez les connaissances de l'équipe", glyph: 'Q', kind: 'brand' },
  { id: 'timer', name: 'Minuteur', desc: 'Cadrez un atelier en temps limité', glyph: 'M', kind: 'neutral' },
  { id: 'retro', name: 'Rétrospective', desc: "Modèle 3 colonnes prêt à l'emploi", glyph: 'R', kind: 'error' },
];

/**
 * Klaxoon-style facilitation-activity picker (Whiteboard design "Activités" panel). Slide-in
 * panel listing the workshop activities that can be launched on a board — brainstorming, poll,
 * dot-vote, icebreaker, quiz, timer, retro — plus a "recently used" shortcut row.
 *
 * Purely presentational: it emits {@link launch} with the chosen activity id and {@link close}.
 * Wiring an activity to a real board action depends on `pivot-collaboratif-core` support (same
 * WIP posture as the board's timer/vote affordances, see `BoardPageComponent`) — until then the
 * host simply closes the panel on select.
 *
 * Labels are inline pending the module-wide Transloco externalisation (shared follow-up).
 */
@Component({
  selector: 'wb-activities-panel',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [],
  templateUrl: './activities-panel.component.html',
  styleUrl: './activities-panel.component.scss',
})
export class ActivitiesPanelComponent {
  @Output() readonly close = new EventEmitter<void>();
  @Output() readonly launch = new EventEmitter<string>();

  protected readonly activities = ACTIVITIES;
  protected readonly recent: readonly WbActivity[] = [ACTIVITIES[0], ACTIVITIES[6]];
}
