import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  HostListener,
  OnDestroy,
  OnInit,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { BoardStore } from '../../core/whiteboard/board.store';
import { BoardService } from '../../core/whiteboard/board.service';
import { ToastService } from '../../core/toast/toast.service';
import { BoardTransport, StompBoardTransport } from '../../core/whiteboard/board-transport';
import { FloatingToolbarComponent } from '../floating-toolbar/floating-toolbar.component';
import { StructuredCanvasComponent } from '../structured-canvas/structured-canvas.component';
import { GroupsPanelComponent } from '../groups-panel/groups-panel.component';
import { ConnectorStylePanelComponent } from '../connector-style-panel/connector-style-panel.component';
import { VoteResultsPanelComponent } from '../vote-results-panel/vote-results-panel.component';
import { TimerOverlayComponent } from '../timer-overlay/timer-overlay.component';
import { SharePanelComponent } from '../share-panel/share-panel.component';
import { ActivitiesPanelComponent } from '../activities-panel/activities-panel.component';
import { BoardSettingsModalComponent } from '../board-settings-modal/board-settings-modal.component';
import { SelectionToolbarComponent } from '../selection-toolbar/selection-toolbar.component';
import type { Board } from '../../core/whiteboard/board.model';
import type { Connection, ConnectionPatch } from '../model/board.types';
import type { ToolMode } from '../model/tools';
import { DEFAULT_SHAPE_COLOR } from '../model/colors';

/** Delay (ms) within which a second click on the Reset button confirms the action (US08.2.4). */
const RESET_CONFIRM_WINDOW_MS = 2000;

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
    ConnectorStylePanelComponent,
    VoteResultsPanelComponent,
    TimerOverlayComponent,
    SharePanelComponent,
    ActivitiesPanelComponent,
    BoardSettingsModalComponent,
    SelectionToolbarComponent,
  ],
  providers: [BoardStore, { provide: BoardTransport, useClass: StompBoardTransport }],
  templateUrl: './board-page.component.html',
  styleUrl: './board-page.component.scss',
})
export class BoardPageComponent implements OnInit, OnDestroy {
  protected readonly store = inject(BoardStore);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  protected readonly boardId = this.route.snapshot.paramMap.get('boardId') ?? '';

  /** The canvas instance — relays the toolbar's explicit image-upload selection to it
   *  (US08.6.4), since insertion logic (dimensioning, positioning) lives on the canvas. */
  private readonly canvas = viewChild(StructuredCanvasComponent);

  protected readonly tool = signal<ToolMode>('select');
  protected readonly color = signal<string>(DEFAULT_SHAPE_COLOR);
  /** SHAPE fill colour (US08.6.3) — `null` means no fill (transparent), the SHAPE default. */
  protected readonly fillColor = signal<string | null>(null);
  protected readonly showGroups = signal(false);
  protected readonly showActivities = signal(false);
  protected readonly showShare = signal(false);
  protected readonly showVoteResults = signal(false);
  protected readonly showSettings = signal(false);
  protected readonly highlightedGroup = signal<string | null>(null);

  protected readonly isOwner = computed(() => this.store.userRole() === 'OWNER');

  /** Count of selected items (cards + connections) — drives the floating selection toolbar. */
  protected readonly selectionCount = computed(() => this.store.selectedIds().size);
  /** True when every selected *card* is locked — flips the toolbar's lock toggle to "unlock". */
  protected readonly allSelectedLocked = computed(() => {
    const ids = this.store.selectedIds();
    if (ids.size === 0) {
      return false;
    }
    const selectedCards = this.store.cards().filter((c) => ids.has(c.id));
    return selectedCards.length > 0 && selectedCards.every((c) => c.locked);
  });

  /**
   * The single selected connector, or `null` when the selection is empty, holds more than one
   * item, or matches a card instead — gates the style panel (US08.7.2). `selectedIds` is the
   * shared card/connection selection signal (see `StructuredCanvasComponent.onConnectionSelect`).
   */
  protected readonly selectedConnection = computed<Connection | null>(() => {
    const ids = this.store.selectedIds();
    if (ids.size !== 1) {
      return null;
    }
    const [id] = ids;
    return this.store.connections().find((c) => c.id === id) ?? null;
  });

  /** Board snapshot passed to the settings modal — kept in sync with the store's loaded board. */
  protected readonly settingsBoard = computed<Board | null>(() => {
    const detail = this.store.board();
    if (!detail) {
      return null;
    }
    return {
      id: detail.id,
      title: detail.name,
      role: 'owner',
      createdAt: '',
      updatedAt: '',
      thumbnailUrl: null,
      activeParticipantCount: 0,
      favorite: false,
      description: detail.description,
      coverImage: detail.coverImage,
      maxParticipants: detail.maxParticipants,
      enabledActivities: detail.enabledActivities ?? [],
      deletedAt: null,
    };
  });

  /** Pending confirmation state for the double-click Reset button (US08.2.4). */
  private resetConfirmTimer: ReturnType<typeof setTimeout> | null = null;
  protected readonly resetPendingConfirm = signal(false);

  private readonly boardService = inject(BoardService);
  private readonly toast = inject(ToastService);
  private readonly hostRef = inject(ElementRef<HTMLElement>);
  protected settingsTriggerEl: HTMLElement | null = null;

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
    if (this.resetConfirmTimer) {
      clearTimeout(this.resetConfirmTimer);
    }
    this.store.destroy();
  }

  /**
   * Reset button click handler — requires two clicks within {@link RESET_CONFIRM_WINDOW_MS}
   * (US08.2.4 AC: "une confirmation est demandée"). First click arms the confirmation (visual
   * state + aria-live announcement); the confirming click calls the REST reset endpoint.
   */
  protected onResetClick(): void {
    if (!this.resetPendingConfirm()) {
      this.resetPendingConfirm.set(true);
      this.resetConfirmTimer = setTimeout(() => this.resetPendingConfirm.set(false), RESET_CONFIRM_WINDOW_MS);
      return;
    }
    if (this.resetConfirmTimer) {
      clearTimeout(this.resetConfirmTimer);
      this.resetConfirmTimer = null;
    }
    this.resetPendingConfirm.set(false);
    this.boardService.resetBoard(this.boardId).subscribe({
      next: () => {
        this.store.cards.set([]);
        this.store.connections.set([]);
        this.store.frames.set([]);
        this.store.selectCards(new Set());
        this.toast.show('whiteboard.board.settings.resetSuccess', 'success');
      },
      error: () => this.toast.show('whiteboard.board.settings.resetError', 'error'),
    });
  }

  /**
   * Returns to the whiteboard boards list (`/whiteboard`) — the header back affordance so the
   * user no longer has to route through the app home to leave an open board.
   */
  protected goBack(): void {
    void this.router.navigateByUrl('/whiteboard');
  }

  protected openSettings(event: Event): void {
    this.settingsTriggerEl = event.currentTarget as HTMLElement;
    this.showSettings.set(true);
  }

  protected closeSettings(): void {
    this.showSettings.set(false);
  }

  protected onSettingsSaved(): void {
    this.showSettings.set(false);
  }

  protected onToolConsumed(): void {
    this.tool.set('select');
  }

  /** Relays the toolbar's explicit image-upload selection to the canvas (US08.6.4). */
  protected onInsertImage(file: File): void {
    void this.canvas()?.insertImageFile(file);
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

  /**
   * Colour picked in the toolbar: recolour the current selection (post-it / shape / etc.) if any,
   * and keep it as the default colour for the next created card. Without the `recolorSelected`
   * call, picking a colour only affected future cards — an existing card could never be recoloured.
   */
  protected onColorChange(color: string): void {
    this.color.set(color);
    this.store.recolorSelected(color);
  }
  protected onDissolveGroup(groupId: string): void {
    this.store.ungroupById(groupId);
  }

  /** Applies a connector restyle patch emitted by the style panel (US08.7.2). */
  protected onConnectorStyleChange(connectionId: string, patch: ConnectionPatch): void {
    this.store.updateConnection(connectionId, patch);
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
    } else if (mod && event.key.toLowerCase() === 'c') {
      if (this.store.selectedIds().size > 0) {
        event.preventDefault();
        this.store.copySelected();
      }
    } else if (mod && event.key.toLowerCase() === 'v') {
      event.preventDefault();
      this.store.pasteFromClipboard();
    } else if (mod && event.key.toLowerCase() === 'd') {
      if (this.store.selectedIds().size > 0) {
        event.preventDefault();
        this.store.duplicateSelected();
      }
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
