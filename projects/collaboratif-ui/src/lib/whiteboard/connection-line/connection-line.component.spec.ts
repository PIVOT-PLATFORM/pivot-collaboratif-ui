import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslocoTestingModule } from '@jsverse/transloco';
import { describe, it, expect, beforeEach } from 'vitest';
import { ConnectionLineComponent } from './connection-line.component';
import type { Connection } from '../model/board.types';
import type { Rect } from '../model/board-geometry';

const FR_TRANSLATIONS = {
  whiteboard: {
    connection: {
      untitledCard: 'carte sans titre',
      ariaLabel: {
        solid: 'Connecteur {{shape}} de {{from}} vers {{to}}',
        dashed: 'Connecteur {{shape}} en pointillés de {{from}} vers {{to}}',
      },
    },
    connector: {
      style: {
        shape: { straight: 'droit', curved: 'courbe', orthogonal: 'orthogonal' },
      },
    },
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
        [fromLabel]="fromLabel()"
        [toLabel]="toLabel()"
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
  readonly fromLabel = signal('Idée 1');
  readonly toLabel = signal('Idée 2');
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

  // ── Rendering: remaining shape/arrow/width/color/label variants (US08.7.2 AC5) ──

  it('renders a straight path ("L" command, no curve/elbow) for shape=straight', () => {
    host.connection.set(makeConnection({ shape: 'straight' }));
    fixture.detectChanges();
    const d = linePath().getAttribute('d') ?? '';
    expect(d).toContain('L');
    expect(d).not.toContain('C');
  });

  it('renders an orthogonal (multi-segment "L") path for shape=orthogonal', () => {
    host.connection.set(makeConnection({ shape: 'orthogonal' }));
    fixture.detectChanges();
    const d = linePath().getAttribute('d') ?? '';
    // Orthogonal routing produces 4 line segments (start stub, corner, end stub, endpoint),
    // vs. straight's single "L" segment.
    expect(d.match(/L/g)?.length).toBe(4);
  });

  it('renders both start and end arrowhead polygons for arrow="both"', () => {
    host.connection.set(makeConnection({ arrow: 'both' }));
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('.wb-connection__arrow').length).toBe(2);
  });

  it('renders a single start arrowhead polygon for arrow="start"', () => {
    host.connection.set(makeConnection({ arrow: 'start' }));
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('.wb-connection__arrow').length).toBe(1);
  });

  it('renders a custom stroke width', () => {
    host.connection.set(makeConnection({ width: 8 }));
    fixture.detectChanges();
    expect(linePath().getAttribute('stroke-width')).toBe('8');
  });

  it('renders a custom stroke colour when set', () => {
    host.connection.set(makeConnection({ color: '#ff0000' }));
    fixture.detectChanges();
    expect(linePath().getAttribute('stroke')).toBe('#ff0000');
  });

  it('renders the label text when a label is set', () => {
    host.connection.set(makeConnection({ label: 'Étape 1' }));
    fixture.detectChanges();
    const labelEl = fixture.nativeElement.querySelector('.wb-connection__label-text');
    expect(labelEl?.textContent?.trim()).toBe('Étape 1');
  });

  // ── A11y: descriptive aria-label + keyboard focusability (US08.7.2 AC6) ────

  it('exposes a role/tabindex-focusable hit-area', () => {
    const hit = hitPath();
    expect(hit.getAttribute('role')).toBe('button');
    expect(hit.getAttribute('tabindex')).toBe('0');
  });

  it('describes shape and direction in the aria-label for a solid connector', () => {
    host.connection.set(makeConnection({ shape: 'curved', dashed: false }));
    fixture.detectChanges();
    expect(hitPath().getAttribute('aria-label')).toBe('Connecteur courbe de Idée 1 vers Idée 2');
  });

  it('mentions "pointillés" (dashed) in the aria-label for a dashed connector', () => {
    host.connection.set(makeConnection({ shape: 'straight', dashed: true }));
    fixture.detectChanges();
    const label = hitPath().getAttribute('aria-label') ?? '';
    expect(label).toContain('pointillés');
    expect(label).toContain('Idée 1');
    expect(label).toContain('Idée 2');
  });

  it('falls back to the generic untitled-card label when an endpoint has no display name', () => {
    host.fromLabel.set('');
    fixture.detectChanges();
    expect(hitPath().getAttribute('aria-label')).toContain('carte sans titre');
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
