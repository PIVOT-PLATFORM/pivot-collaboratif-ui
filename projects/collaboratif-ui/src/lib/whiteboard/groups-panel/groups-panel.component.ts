import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
} from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { Card } from '../model/board.types';
import { GROUP_COLORS, groupColor } from '../model/colors';

/** A recolor request emitted when the user picks a new ring colour for a group. */
export interface GroupRecolor {
  /** Identifier of the group whose ring colour changes. */
  groupId: string;
  /** New ring colour, a value taken from {@link GROUP_COLORS}. */
  color: string;
}

/** A single displayable group row derived from the board's cards. */
interface GroupRow {
  /** Shared `groupId` of the member cards. */
  id: string;
  /** 1-based display index used for the "Group N" label. */
  index: number;
  /** Current ring colour: the members' explicit `groupColor` or a deterministic fallback. */
  color: string;
  /** Number of cards belonging to the group. */
  memberCount: number;
}

/**
 * Groups side panel (ported from the PouetPouet `GroupsPanel` React component).
 *
 * Lists every distinct group present on the board — a set of cards sharing a
 * non-null `groupId`, with at least two members. Each row shows the group's
 * ring colour swatch, a "Group N" label and its member count. The panel is a
 * pure presentational component: it derives its rows from {@link cards} and
 * emits intent through {@link highlight}, {@link recolor} and {@link dissolve},
 * delegating all mutation to the host.
 */
@Component({
  selector: 'wb-groups-panel',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslocoPipe],
  templateUrl: './groups-panel.component.html',
  styleUrl: './groups-panel.component.scss',
})
export class GroupsPanelComponent {
  /** Board cards from which the group rows are derived. */
  readonly cards = input.required<Card[]>();

  /** Identifier of the group currently highlighted on the canvas, if any. */
  readonly highlightedGroupId = input<string | null>(null);

  /** Emits a group id to highlight, or `null` to clear the highlight. */
  readonly highlight = output<string | null>();

  /** Emits a request to recolour a group's ring. */
  readonly recolor = output<GroupRecolor>();

  /** Emits the id of a group the user wants to dissolve. */
  readonly dissolve = output<string>();

  /** Palette of ring colours offered by the per-group colour picker. */
  protected readonly paletteColors: readonly string[] = GROUP_COLORS;

  /**
   * Distinct groups derived from {@link cards}: cards sharing a non-null
   * `groupId`, keeping only groups of two or more members, in first-seen order.
   */
  protected readonly groups = computed<GroupRow[]>(() => {
    const membersById = new Map<string, Card[]>();
    for (const card of this.cards()) {
      if (card.groupId === null) {
        continue;
      }
      const bucket = membersById.get(card.groupId) ?? [];
      bucket.push(card);
      membersById.set(card.groupId, bucket);
    }

    const rows: GroupRow[] = [];
    let index = 0;
    for (const [id, members] of membersById) {
      if (members.length < 2) {
        continue;
      }
      index += 1;
      const explicit = members.find(card => card.groupColor !== null)?.groupColor;
      rows.push({
        id,
        index,
        color: explicit ?? groupColor(id),
        memberCount: members.length,
      });
    }
    return rows;
  });

  /** Highlights the given group (row hover / focus enter). */
  protected onEnter(groupId: string): void {
    this.highlight.emit(groupId);
  }

  /** Clears the highlight (row hover / focus leave). */
  protected onLeave(): void {
    this.highlight.emit(null);
  }

  /** Requests a recolour of the given group. */
  protected onRecolor(groupId: string, color: string): void {
    this.recolor.emit({ groupId, color });
  }

  /** Requests the dissolution of the given group. */
  protected onDissolve(groupId: string): void {
    this.dissolve.emit(groupId);
  }
}
