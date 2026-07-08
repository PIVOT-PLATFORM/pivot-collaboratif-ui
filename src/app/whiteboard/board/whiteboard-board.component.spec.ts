import { ChangeDetectionStrategy, Component, input, output, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { TranslocoPipe, TranslocoTestingModule } from '@jsverse/transloco';
import { Subject } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DrawAction, UndoEvent } from '../canvas/whiteboard-canvas.component';
import {
  SyncDrawAction,
  WhiteboardConnectionStatus,
  WhiteboardSyncService,
} from '../../core/whiteboard/whiteboard-sync.service';
import { WhiteboardBoardComponent } from './whiteboard-board.component';

/** Stub standing in for `WhiteboardCanvasComponent` — isolates this container's own logic. */
@Component({
  selector: 'app-whiteboard-canvas',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '',
})
class StubCanvasComponent {
  readonly readOnly = input<boolean>(false);
  readonly drawAction = output<DrawAction>();
  readonly undoAction = output<UndoEvent>();
  applyRemoteAction = vi.fn();
}

const FR: Record<string, unknown> = {
  whiteboard: {
    ws: {
      connecting: 'Connexion en cours…',
      lost: 'Connexion perdue — tentative de reconnexion',
      reconnected: 'Reconnecté',
      failed: 'Impossible de rejoindre le tableau',
      retryManual: 'Réessayer manuellement',
      offline: 'Mode hors ligne — les modifications ne sont pas sauvegardées',
      revoked: 'Vous n\'avez plus accès à ce tableau',
    },
  },
};

class FakeSyncService {
  readonly status = signal<WhiteboardConnectionStatus>('connecting');
  readonly readOnly = signal(true);
  readonly browserOffline = signal(false);
  readonly showReconnectedToast = signal(false);
  readonly remoteActions$ = new Subject<SyncDrawAction>();
  connect = vi.fn();
  disconnect = vi.fn();
  publishDraw = vi.fn();
  publish = vi.fn();
  retryManual = vi.fn();
}

describe('WhiteboardBoardComponent', () => {
  let fixture: ComponentFixture<WhiteboardBoardComponent>;
  let sync: FakeSyncService;

  beforeEach(async () => {
    sync = new FakeSyncService();

    await TestBed.configureTestingModule({
      imports: [
        WhiteboardBoardComponent,
        TranslocoTestingModule.forRoot({
          langs: { fr: FR },
          translocoConfig: { defaultLang: 'fr', availableLangs: ['fr'] },
          preloadLangs: true,
        }),
      ],
      providers: [
        { provide: WhiteboardSyncService, useValue: sync },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { paramMap: convertToParamMap({ boardId: 'board-42' }) } },
        },
      ],
    })
      .overrideComponent(WhiteboardBoardComponent, {
        set: { imports: [TranslocoPipe, StubCanvasComponent] },
      })
      .compileComponents();

    fixture = TestBed.createComponent(WhiteboardBoardComponent);
  });

  afterEach(() => vi.restoreAllMocks());

  it('connects to the board from the route param after the view is initialised', () => {
    fixture.detectChanges();
    expect(sync.connect).toHaveBeenCalledWith('board-42');
  });

  it('disconnects the sync service on destroy', () => {
    fixture.detectChanges();
    fixture.destroy();
    expect(sync.disconnect).toHaveBeenCalled();
  });

  it('falls back to an empty boardId when the route param is absent (defensive)', async () => {
    TestBed.resetTestingModule();
    sync = new FakeSyncService();
    await TestBed.configureTestingModule({
      imports: [
        WhiteboardBoardComponent,
        TranslocoTestingModule.forRoot({
          langs: { fr: FR },
          translocoConfig: { defaultLang: 'fr', availableLangs: ['fr'] },
          preloadLangs: true,
        }),
      ],
      providers: [
        { provide: WhiteboardSyncService, useValue: sync },
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap({}) } } },
      ],
    })
      .overrideComponent(WhiteboardBoardComponent, {
        set: { imports: [TranslocoPipe, StubCanvasComponent] },
      })
      .compileComponents();

    const noParamFixture = TestBed.createComponent(WhiteboardBoardComponent);
    noParamFixture.detectChanges();

    expect(sync.connect).toHaveBeenCalledWith('');
  });

  it('shows the "connecting" banner (role=status) while status is connecting', () => {
    sync.status.set('connecting');
    fixture.detectChanges();
    const banner = fixture.nativeElement.querySelector('.wb-status-banner--info');
    expect(banner?.getAttribute('role')).toBe('status');
    expect(banner?.textContent).toContain('Connexion en cours');
  });

  it('shows the "lost" banner while status is lost', () => {
    sync.status.set('lost');
    fixture.detectChanges();
    const banner = fixture.nativeElement.querySelector('.wb-status-banner--warning');
    expect(banner?.textContent).toContain('Connexion perdue');
  });

  it('shows the "failed" banner with a manual retry button, wired to retryManual()', () => {
    sync.status.set('failed');
    fixture.detectChanges();

    const banner = fixture.nativeElement.querySelector('.wb-status-banner--error');
    expect(banner?.textContent).toContain('Impossible de rejoindre le tableau');

    const retryButton: HTMLButtonElement = fixture.nativeElement.querySelector(
      '.wb-status-banner__retry',
    );
    retryButton.click();
    expect(sync.retryManual).toHaveBeenCalled();
  });

  it('shows the offline banner when the browser is offline, independent of WS status', () => {
    sync.status.set('open');
    sync.browserOffline.set(true);
    fixture.detectChanges();
    const banner = fixture.nativeElement.querySelector('.wb-status-banner--offline');
    expect(banner?.textContent).toContain('Mode hors ligne');
  });

  it('shows the reconnected toast (role=status) when the service signals it', () => {
    sync.showReconnectedToast.set(true);
    fixture.detectChanges();
    const toast = fixture.nativeElement.querySelector('.wb-toast');
    expect(toast?.getAttribute('role')).toBe('status');
    expect(toast?.textContent).toContain('Reconnecté');
  });

  it('publishes a local draw action emitted by the canvas', () => {
    fixture.detectChanges();
    const stub = fixture.debugElement.query(de => de.name === 'app-whiteboard-canvas')
      ?.componentInstance as StubCanvasComponent;

    const action: DrawAction = { type: 'DRAW', subType: 'stroke', payload: { id: 'obj-1' } };
    stub.drawAction.emit(action);

    expect(sync.publishDraw).toHaveBeenCalledWith('stroke', { id: 'obj-1' });
  });

  it('relays a local undo as UNDO { eventId } over STOMP (US08.3.3 AC5)', () => {
    fixture.detectChanges();
    const stub = fixture.debugElement.query(de => de.name === 'app-whiteboard-canvas')
      ?.componentInstance as StubCanvasComponent;

    stub.undoAction.emit({ eventId: 'evt-42' });

    expect(sync.publish).toHaveBeenCalledWith('UNDO', { eventId: 'evt-42' });
  });

  it('forwards validated remote actions to the canvas via applyRemoteAction', () => {
    fixture.detectChanges();
    const stub = fixture.debugElement.query(de => de.name === 'app-whiteboard-canvas')
      ?.componentInstance as StubCanvasComponent;

    const action: SyncDrawAction = { type: 'DRAW', subType: 'shape', payload: { id: 'x' } };
    sync.remoteActions$.next(action);

    expect(stub.applyRemoteAction).toHaveBeenCalledWith(action);
  });

  it('binds readOnly from the sync service to the canvas input', () => {
    sync.readOnly.set(true);
    fixture.detectChanges();
    const stub = (fixture.debugElement.query(de => de.name === 'app-whiteboard-canvas'))
      ?.componentInstance as StubCanvasComponent;
    expect(stub.readOnly()).toBe(true);
  });
});
