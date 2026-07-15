import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslocoTestingModule } from '@jsverse/transloco';
import { describe, it, expect, beforeEach } from 'vitest';
import { ConnectionLineComponent } from './connection-line.component';
import type { Connection } from '../model/board.types';
import type { Rect } from '../model/board-geometry';

const FR_TRANSLATIONS = {
  whiteboard: {
    connection: { ariaLabel: 'Connexion' },
  },
};

function makeConnection(overrides: Partial<Connection> = {}): Connection {
  return {
    id: 'conn-1',
    boardId: 'board-1',
    fromId: 'card-a',
    toId: 'card-b',
    label: null,
    color: null,
    shape: 'curved',
    arrow: 'none',
    dashed: false,
    width: 2,
    ...overrides,
  };
}

const FROM_RECT: Rect = { x: 0, y: 0, width: 192, height: 128 };
const TO_RECT: Rect = { x: 400, y: 300, width: 192, height: 128 };

/** Host wrapping the `[wbConnectionLine]` attribute selector inside a real `<svg>` root. */
@Component({
  standalone: true,
  imports: [ConnectionLineComponent],
  template: `
    <svg>
      <g
        wbConnectionLine
        [connection]="connection()"
        [fromRect]="fromRect()"
        [toRect]="toRect()"
        [selected]="selected()"
        (select)="onSelect($event)"
      ></g>
    </svg>
  `,
})
class HostComponent {
  readonly connection = signal<Connection>(makeConnection());
  readonly fromRect = signal<Rect>(FROM_RECT);
  readonly toRect = signal<Rect>(TO_RECT);
  readonly selected = signal(false);
  selectedId: string | null = null;

  onSelect(id: string): void {
    this.selectedId = id;
  }
}

describe('ConnectionLineComponent (US08.7.1)', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [
        HostComponent,
        TranslocoTestingModule.forRoot({
          langs: { fr: FR_TRANSLATIONS },
          translocoConfig: { defaultLang: 'fr', availableLangs: ['fr'] },
          preloadLangs: true,
        }),
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
    fixture.detectChanges();
  });

  function hitPath(): SVGPathElement {
    return fixture.nativeElement.querySelector('.wb-connection__hit') as SVGPathElement;
  }

  function linePath(): SVGPathElement {
    return fixture.nativeElement.querySelector('.wb-connection__line') as SVGPathElement;
  }

  // ── Rendering with fixed creation-time defaults (shape=curved, arrow=none, dashed=false, width=2) ──

  it('renders a curved path (cubic Bézier "C" command) for the default shape', () => {
    expect(linePath().getAttribute('d')).toContain('C');
  });

  it('renders no arrowhead polygon for arrow="none"', () => {
    expect(fixture.nativeElement.querySelector('.wb-connection__arrow')).toBeNull();
  });

  it('renders a solid line (no stroke-dasharray) for dashed=false', () => {
    expect(linePath().getAttribute('stroke-dasharray')).toBeNull();
  });

  it('renders the default stroke width of 2', () => {
    expect(linePath().getAttribute('stroke-width')).toBe('2');
  });

  it('renders no label box when label is null', () => {
    expect(fixture.nativeElement.querySelector('.wb-connection__label')).toBeNull();
  });

  it('falls back to the neutral default colour when color is null', () => {
    expect(linePath().getAttribute('stroke')).toBe('#9ca3af');
  });

  it('renders an arrowhead polygon when arrow="end"', () => {
    host.connection.set(makeConnection({ arrow: 'end' }));
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.wb-connection__arrow')).not.toBeNull();
  });

  it('renders a dashed stroke when dashed=true', () => {
    host.connection.set(makeConnection({ dashed: true }));
    fixture.detectChanges();
    expect(linePath().getAttribute('stroke-dasharray')).not.toBeNull();
  });

  // ── A11y: aria-label + keyboard focusability ────────────────────────────────

  it('exposes an accessible aria-label on the focusable hit-area', () => {
    const hit = hitPath();
    expect(hit.getAttribute('role')).toBe('button');
    expect(hit.getAttribute('tabindex')).toBe('0');
    expect(hit.getAttribute('aria-label')).toBe('Connexion');
  });

  // ── Selection ────────────────────────────────────────────────────────────────

  it('emits select with the connection id on click', () => {
    hitPath().dispatchEvent(new MouseEvent('click', { bubbles: true }));
    fixture.detectChanges();
    expect(host.selectedId).toBe('conn-1');
  });

  it('emits select with the connection id on Enter keydown (keyboard activation)', () => {
    hitPath().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    fixture.detectChanges();
    expect(host.selectedId).toBe('conn-1');
  });

  it('emits select with the connection id on Space keydown (keyboard activation)', () => {
    hitPath().dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    fixture.detectChanges();
    expect(host.selectedId).toBe('conn-1');
  });

  it('renders a selection halo only when selected=true', () => {
    expect(fixture.nativeElement.querySelector('.wb-connection__halo')).toBeNull();

    host.selected.set(true);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.wb-connection__halo')).not.toBeNull();
  });
});
