import {
  ChangeDetectionStrategy,
  Component,
  HostListener,
  OnDestroy,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { BoardStore } from '../../core/whiteboard/board.store';
import { BoardTransport, StompBoardTransport } from '../../core/whiteboard/board-transport';
import { FloatingToolbarComponent } from '../floating-toolbar/floating-toolbar.component';
import { StructuredCanvasComponent } from '../structured-canvas/structured-canvas.component';
import { GroupsPanelComponent } from '../groups-panel/groups-panel.component';
import { VoteResultsPanelComponent } from '../vote-results-panel/vote-results-panel.component';
import { TimerOverlayComponent } from '../timer-overlay/timer-overlay.component';
import { SharePanelComponent } from '../share-panel/share-panel.component';
import { ActivitiesPanelComponent } from '../activities-panel/activities-panel.component';
import type { ToolMode } from '../model/tools';
import { DEFAULT_SHAPE_COLOR } from '../model/colors';

/**
 * Route container for a single structured board (`/whiteboard/:boardId`). The Angular
 * counterpart of PouetPouet's `boards/[id]/page.tsx`.
 *
 * Provides a board-scoped {@link BoardStore} and {@link BoardTransport} (component-level
 * providers → one isolated instance per open board), drives its lifecycle, owns the active
 * tool/colour, board-level keyboard shortcuts, and composes the toolbar, canvas, panels,
 * overlays and the (previously orphaned) share panel.
 *
 * ⚠️ WIP: several affordances (timer/vote start, fields panel, import/export, settings)
 * depend on backend actions not yet implemented in `pivot-collaboratif-core`; they are wired
 * to the store but have no server to answer them yet — see the port EPIC.
 */
@Component({
  selector: 'wb-board-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    TranslocoPipe,
    FloatingToolbarComponent,
    StructuredCanvasComponent,
    GroupsPanelComponent,
    VoteResultsPanelComponent,
    TimerOverlayComponent,
    SharePanelComponent,
    ActivitiesPanelComponent,
  ],
  providers: [BoardStore, { provide: BoardTransport, useClass: StompBoardTransport }],
  templateUrl: './board-page.component.html',
  styleUrl: './board-page.component.scss',
})
export class BoardPageComponent implements OnInit, OnDestroy {
  protected readonly store = inject(BoardStore);
  private readonly route = inject(ActivatedRoute);

  protected readonly boardId = this.route.snapshot.paramMap.get('boardId') ?? '';

  protected readonly tool = signal<ToolMode>('select');
  protected readonly color = signal<string>(DEFAULT_SHAPE_COLOR);
  protected readonly showGroups = signal(false);
  protected readonly showActivities = signal(false);
  protected readonly showShare = signal(false);
  protected readonly showVoteResults = signal(false);
  protected readonly highlightedGroup = signal<string | null>(null);

  protected readonly isOwner = computed(() => this.store.userRole() === 'OWNER');

  /** Live "time's up" flag — true once the running timer's end time passes. */
  private readonly now = signal(Date.now());
  protected readonly timerExpired = computed(() => {
    const ends = this.store.timerEndsAt();
    return ends !== null && this.now() >= ends;
  });
  protected readonly timerRunning = computed(() => this.store.timerEndsAt() !== null);
  private tick?: ReturnType<typeof setInterval>;

  ngOnInit(): void {
    this.store.init(this.boardId);
    this.tick = setInterval(() => this.now.set(Date.now()), 500);
  }

  ngOnDestroy(): void {
    clearInterval(this.tick);
    this.store.destroy();
  }

  protected onToolConsumed(): void {
    this.tool.set('select');
  }

  /**
   * Placeholder handler for the activities picker: launching a facilitation activity on the board
   * depends on `pivot-collaboratif-core` support not yet implemented (same WIP posture as
   * timer/vote start). For now, selecting an activity simply closes the panel.
   */
  protected onLaunchActivity(_activityId: string): void {
    this.showActivities.set(false);
  }

  protected dismissTimer(): void {
    this.store.stopTimer();
  }

  protected onRecolorGroup(e: { groupId: string; color: string }): void {
    this.store.recolorGroup(e.groupId, e.color);
  }
  protected onDissolveGroup(groupId: string): void {
    this.store.ungroupById(groupId);
  }

  /** Board-level keyboard shortcuts (ignored while typing in an input/textarea). */
  @HostListener('document:keydown', ['$event'])
  protected onKeydown(event: KeyboardEvent): void {
    const el = event.target as HTMLElement;
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable) {
      return;
    }
    const mod = event.ctrlKey || event.metaKey;
    if (mod && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      if (event.shiftKey) {
        this.store.redo();
      } else {
        this.store.undo();
      }
    } else if (mod && event.key.toLowerCase() === 'y') {
      event.preventDefault();
      this.store.redo();
    } else if (mod && event.key.toLowerCase() === 'a') {
      event.preventDefault();
      this.store.selectCards(new Set(this.store.cards().map((c) => c.id)));
    } else if (event.key === 'Delete' || event.key === 'Backspace') {
      if (this.store.selectedIds().size > 0) {
        event.preventDefault();
        this.store.deleteSelected();
      }
    } else if (event.key === 'Escape') {
      this.store.selectCards(new Set());
    } else if (event.key.startsWith('Arrow')) {
      const step = event.shiftKey ? 20 : 1;
      const map: Record<string, [number, number]> = {
        ArrowLeft: [-step, 0],
        ArrowRight: [step, 0],
        ArrowUp: [0, -step],
        ArrowDown: [0, step],
      };
      const delta = map[event.key];
      if (delta && this.store.selectedIds().size > 0) {
        event.preventDefault();
        this.store.moveSelectedBy(delta[0], delta[1]);
      }
    }
  }
}
