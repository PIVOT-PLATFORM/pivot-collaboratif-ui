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
import { BoardFieldsPanelComponent } from '../board-fields-panel/board-fields-panel.component';
import { CardFieldValuesPanelComponent } from '../card-field-values-panel/card-field-values-panel.component';
import { ConnectorStylePanelComponent } from '../connector-style-panel/connector-style-panel.component';
import { VoteResultsPanelComponent } from '../vote-results-panel/vote-results-panel.component';
import { TimerOverlayComponent } from '../timer-overlay/timer-overlay.component';
import { SharePanelComponent } from '../share-panel/share-panel.component';
import { ActivitiesPanelComponent } from '../activities-panel/activities-panel.component';
import { TimerConfigDialogComponent } from '../timer-config-dialog/timer-config-dialog.component';
import { VoteConfigDialogComponent, type VoteConfig } from '../vote-config-dialog/vote-config-dialog.component';
import { BoardSettingsModalComponent } from '../board-settings-modal/board-settings-modal.component';
import { ShortcutsPanelComponent } from '../shortcuts-panel/shortcuts-panel.component';
import { SelectionToolbarComponent } from '../selection-toolbar/selection-toolbar.component';
import { ImportKlaxoonModalComponent } from '../import-klaxoon-modal/import-klaxoon-modal.component';
import type { Board } from '../../core/whiteboard/board.model';
import type { Card, Connection, ConnectionPatch, ConnArrow } from '../model/board.types';
import { TOOL_SHORTCUTS, type ToolMode } from '../model/tools';
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
 * The shared timer and dot-vote (US08.12.1/2) are wired end-to-end to the store's STOMP
 * actions. Klaxoon import (US08.13.1) is wired here as trigger + `<dialog>` host for
 * {@link ImportKlaxoonModalComponent}; the imported content itself renders through the
 * `board:imported` STOMP broadcast the store already merges (`board.store.ts`), not through
 * this component's state.
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
    BoardFieldsPanelComponent,
    CardFieldValuesPanelComponent,
    ConnectorStylePanelComponent,
    VoteResultsPanelComponent,
    TimerOverlayComponent,
    SharePanelComponent,
    ActivitiesPanelComponent,
    TimerConfigDialogComponent,
    VoteConfigDialogComponent,
    BoardSettingsModalComponent,
    ShortcutsPanelComponent,
    SelectionToolbarComponent,
    ImportKlaxoonModalComponent,
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
  /**
   * True once the user actively picked a colour (toolbar swatch or selection recolour). Until
   * then a new card keeps its type's own default — {@link color} starts at the *shape* colour,
   * so inheriting it unconditionally would turn fresh post-its indigo instead of soft yellow.
   */
  protected readonly colorPicked = signal(false);
  /** SHAPE fill colour (US08.6.3) — `null` means no fill (transparent), the SHAPE default. */
  protected readonly fillColor = signal<string | null>(null);
  /** Whether the keyboard shortcut cheat-sheet is open (toggled by `?`). */
  protected readonly showShortcuts = signal(false);
  /** Arrowhead preset applied to the next connector drawn (US08.7.2 — chosen before drawing). */
  protected readonly connectorArrow = signal<ConnArrow>('none');
  /** Dashed preset applied to the next connector drawn. */
  protected readonly connectorDashed = signal(false);
  protected readonly showGroups = signal(false);
  /** US08.10.1 — board custom-fields definition panel visibility. */
  protected readonly showFields = signal(false);
  protected readonly showActivities = signal(false);
  protected readonly showShare = signal(false);
  protected readonly showVoteResults = signal(false);
  /** US08.12.1 — timer duration picker visibility (opened from the activities panel). */
  protected readonly showTimerConfig = signal(false);
  /** US08.12.2 — dot-vote configuration picker visibility (opened from the activities panel). */
  protected readonly showVoteConfig = signal(false);
  protected readonly showSettings = signal(false);
  /** US08.13.1 — Klaxoon import modal visibility. */
  protected readonly showImportKlaxoon = signal(false);
  protected readonly highlightedGroup = signal<string | null>(null);

  protected readonly isOwner = computed(() => this.store.userRole() === 'OWNER');

  /** Count of selected items (cards + connections) — drives the floating selection toolbar. */
  protected readonly selectionCount = computed(() => this.store.selectedIds().size);
  /** Colour shown on the selection toolbar's swatch — the first selected card's colour, or the
   *  board's active colour when the selection holds no card (connections only). */
  protected readonly selectionColor = computed(() => {
    const ids = this.store.selectedIds();
    return this.store.cards().find((c) => ids.has(c.id))?.color ?? this.color();
  });
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

  /**
   * The single selected card, or `null` when the selection is empty, holds more than one item,
   * or matches a connection instead — gates the per-card field-value editor (US08.10.2). Derived
   * from the same shared {@link BoardStore.selectedIds} signal as {@link selectedConnection}.
   */
  protected readonly selectedCard = computed<Card | null>(() => {
    const ids = this.store.selectedIds();
    if (ids.size !== 1) {
      return null;
    }
    const [id] = ids;
    return this.store.cards().find((c) => c.id === id) ?? null;
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
  /** Whole seconds remaining on the shared timer, or `null` when no timer runs (US08.12.1). */
  protected readonly timerRemaining = computed<number | null>(() => {
    const ends = this.store.timerEndsAt();
    if (ends === null) {
      return null;
    }
    return Math.max(0, Math.ceil((ends - this.now()) / 1000));
  });
  /** `m:ss` label for the running-timer pill. */
  protected readonly timerRemainingLabel = computed(() => {
    const total = this.timerRemaining();
    if (total === null) {
      return '';
    }
    const min = Math.floor(total / 60);
    const sec = total % 60;
    return `${min}:${String(sec).padStart(2, '0')}`;
  });
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

  protected onSettingsSaved(updated: Board): void {
    // The settings modal persists via BoardService directly, so push the saved values back
    // into the store — otherwise the header title and a reopened modal show stale data until
    // a full reload (US08.2.4 recette finding).
    this.store.applySavedMetadata({
      title: updated.title,
      description: updated.description,
      coverImage: updated.coverImage,
      maxParticipants: updated.maxParticipants,
      enabledActivities: updated.enabledActivities,
    });
    this.showSettings.set(false);
  }

  protected onToolConsumed(): void {
    this.tool.set('select');
  }

  /** Clears the current selection — closes the per-card field-value editor (US08.10.2). */
  protected clearSelection(): void {
    this.store.selectCards(new Set());
  }

  /** Relays the toolbar's explicit image-upload selection to the canvas (US08.6.4). */
  protected onInsertImage(file: File): void {
    void this.canvas()?.insertImageFile(file);
  }

  /**
   * Handler for the activities picker. The shared timer (US08.12.1) is wired to the store, so
   * selecting it opens the duration picker; the remaining activities have no backend action yet
   * and simply close the panel.
   */
  protected onLaunchActivity(activityId: string): void {
    this.showActivities.set(false);
    if (activityId === 'timer') {
      this.showTimerConfig.set(true);
    } else if (activityId === 'dotvote') {
      this.showVoteConfig.set(true);
    }
  }

  /** Starts the shared timer for the chosen duration (US08.12.1), closing the picker. */
  protected onStartTimer(seconds: number): void {
    this.store.startTimer(seconds);
    this.showTimerConfig.set(false);
  }

  /**
   * Starts a dot-vote (US08.12.2) and reveals the live results panel. The eligible-voter list is
   * left empty — the backend treats that as "anyone with board access", gated by the per-person
   * quota — so no client-side member enumeration is needed.
   */
  protected onStartVote(config: VoteConfig): void {
    this.store.startVote({ ...config, voterIds: [] });
    this.showVoteConfig.set(false);
    this.showVoteResults.set(true);
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
    // An explicit pick (toolbar swatch or selection recolour) becomes the colour applied to
    // whatever is created next, whatever its type.
    this.colorPicked.set(true);
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
    } else if (mod && event.key.toLowerCase() === 'x') {
      if (this.store.selectedIds().size > 0) {
        event.preventDefault();
        this.store.cutSelected();
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
      // The cheat-sheet is the topmost transient layer — Escape dismisses it first, and only a
      // second press falls through to clearing the selection.
      if (this.showShortcuts()) {
        this.showShortcuts.set(false);
      } else {
        this.store.selectCards(new Set());
      }
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
    } else if (!mod && !event.altKey) {
      // Bare-letter tool shortcuts, and `?` for the cheat-sheet. Last in the chain so no modifier
      // combination above can be shadowed, and skipped entirely when a modifier is held — `Ctrl+P`
      // must stay the browser's print, not the pencil.
      if (event.key === '?') {
        event.preventDefault();
        this.showShortcuts.update((v) => !v);
        return;
      }
      const mode = TOOL_SHORTCUTS[event.key.toLowerCase()];
      if (mode && !this.store.isReadonly()) {
        event.preventDefault();
        this.tool.set(mode);
      }
    }
  }
}
