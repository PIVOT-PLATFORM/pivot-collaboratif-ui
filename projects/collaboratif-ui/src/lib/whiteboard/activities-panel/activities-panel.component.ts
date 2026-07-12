import { ChangeDetectionStrategy, Component, EventEmitter, Output } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';

/**
 * One facilitation activity offered by the Klaxoon-style picker. `name`/`desc` are not carried
 * here: they are looked up by {@link id} under the `whiteboard.activities.items.*` Transloco
 * namespace, so the catalogue stays fully localised.
 */
export interface WbActivity {
  readonly id: string;
  readonly glyph: string;
  /** Nom de TON du design system (`.pv-tone-*`). */
  readonly kind: 'brand' | 'info' | 'success' | 'warning' | 'danger' | 'neutral';
}

const ACTIVITIES: readonly WbActivity[] = [
  { id: 'brainstorming', glyph: 'B', kind: 'brand' },
  { id: 'poll', glyph: 'S', kind: 'info' },
  { id: 'dotvote', glyph: 'V', kind: 'success' },
  { id: 'icebreaker', glyph: 'I', kind: 'warning' },
  { id: 'quiz', glyph: 'Q', kind: 'brand' },
  { id: 'timer', glyph: 'M', kind: 'neutral' },
  { id: 'retro', glyph: 'R', kind: 'danger' },
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
 * All labels are externalised under the `whiteboard.activities.*` Transloco namespace.
 */
@Component({
  selector: 'wb-activities-panel',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslocoPipe],
  templateUrl: './activities-panel.component.html',
  styleUrl: './activities-panel.component.scss',
})
export class ActivitiesPanelComponent {
  @Output() readonly close = new EventEmitter<void>();
  @Output() readonly launch = new EventEmitter<string>();

  protected readonly activities = ACTIVITIES;
  protected readonly recent: readonly WbActivity[] = [ACTIVITIES[0], ACTIVITIES[6]];
}
