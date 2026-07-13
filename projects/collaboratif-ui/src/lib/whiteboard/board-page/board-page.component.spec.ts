import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ActivatedRoute } from '@angular/router';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { BoardPageComponent } from './board-page.component';
import { BoardStore } from '../../core/whiteboard/board.store';
import { BoardTransport } from '../../core/whiteboard/board-transport';
import { COLLABORATIF_API_URL } from '../../core/whiteboard/config/tokens';

/** Inert transport — the board-page delta under test never drives the wire. */
class NoopTransport extends BoardTransport {
  connect(): void {}
  disconnect(): void {}
  emit(): void {}
  on<T = unknown>(_type: string, _handler: (data: T) => void): () => void {
    return () => {};
  }
  onReconnect(_handler: () => void): () => void {
    return () => {};
  }
}

/** Protected surface exercised by these tests. */
interface BoardPageApi {
  showActivities(): boolean;
  onLaunchActivity(id: string): void;
}

describe('BoardPageComponent — activities panel wiring', () => {
  function create(): BoardPageApi {
    const fixture = TestBed.createComponent(BoardPageComponent);
    // No detectChanges(): ngOnInit (store.init HTTP + polling interval) stays dormant — this
    // suite only covers the local activities-panel toggle introduced on this branch.
    return fixture.componentInstance as unknown as BoardPageApi;
  }

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [BoardPageComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: COLLABORATIF_API_URL, useValue: 'http://localhost:8083/api/collaboratif' },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { paramMap: new Map([['boardId', 'board-1']]) } },
        },
      ],
    }).overrideComponent(BoardPageComponent, {
      set: { providers: [BoardStore, { provide: BoardTransport, useClass: NoopTransport }] },
    });
  });

  afterEach(() => TestBed.resetTestingModule());

  it('keeps the activities panel closed by default', () => {
    expect(create().showActivities()).toBe(false);
  });

  it('closes the activities panel when an activity is launched (WIP placeholder)', () => {
    const cmp = create();
    (cmp as unknown as { showActivities: { set(v: boolean): void } }).showActivities.set(true);
    expect(cmp.showActivities()).toBe(true);

    cmp.onLaunchActivity('poll');

    expect(cmp.showActivities()).toBe(false);
  });
});
