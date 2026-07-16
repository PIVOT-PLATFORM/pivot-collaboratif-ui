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
        dotted: 'Connecteur {{shape}} en pointillé fin de {{from}} vers {{to}}',
        caps: ' (départ : {{start}}, arrivée : {{end}})',
      },
    },
    connector: {
      style: {
        shape: { straight: 'droit', curved: 'courbe', orthogonal: 'orthogonal' },
        cap: { none: 'aucun', arrow: 'flèche', triangle: 'triangle', circle: 'cercle', diamond: 'losange' },
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
    lineStyle: 'solid',
    startCap: 'none',
    endCap: 'none',
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

  it('renders no cap marker when both caps are "none"', () => {
    expect(fixture.nativeElement.querySelector('.wb-connection__cap')).toBeNull();
  });

  it('renders a solid line (no stroke-dasharray) for lineStyle="solid"', () => {
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

  it('renders an arrow cap polygon when endCap="arrow"', () => {
    host.connection.set(makeConnection({ endCap: 'arrow' }));
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.wb-connection__cap')).not.toBeNull();
  });

  it('renders a dashed stroke (stroke-dasharray) when lineStyle="dashed"', () => {
    host.connection.set(makeConnection({ lineStyle: 'dashed' }));
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

  it('renders both a start and an end cap marker when both caps are set', () => {
    host.connection.set(makeConnection({ startCap: 'arrow', endCap: 'triangle' }));
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('.wb-connection__cap').length).toBe(2);
  });

  it('renders a single start cap marker when only startCap is set', () => {
    host.connection.set(makeConnection({ startCap: 'arrow' }));
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('.wb-connection__cap').length).toBe(1);
  });

  // ── Extended line styles (US08.7.2 — solid/dashed/dotted) ──────────────────

  it('renders a distinct dotted dash-array (finer than dashed) for lineStyle="dotted"', () => {
    host.connection.set(makeConnection({ lineStyle: 'dotted', width: 2 }));
    fixture.detectChanges();
    const dotted = linePath().getAttribute('stroke-dasharray');
    host.connection.set(makeConnection({ lineStyle: 'dashed', width: 2 }));
    fixture.detectChanges();
    const dashed = linePath().getAttribute('stroke-dasharray');
    expect(dotted).not.toBeNull();
    expect(dashed).not.toBeNull();
    expect(dotted).not.toBe(dashed);
  });

  // ── Extended endpoint caps (US08.7.2 — arrow/triangle/circle/diamond, each end) ──

  it('renders a polygon cap for arrow/triangle/diamond and a circle cap for circle, at the end', () => {
    for (const cap of ['arrow', 'triangle', 'diamond'] as const) {
      host.connection.set(makeConnection({ endCap: cap }));
      fixture.detectChanges();
      const poly = fixture.nativeElement.querySelector('polygon.wb-connection__cap');
      expect(poly, `endCap=${cap} should render a polygon`).not.toBeNull();
    }
    host.connection.set(makeConnection({ endCap: 'circle' }));
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('circle.wb-connection__cap')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('polygon.wb-connection__cap')).toBeNull();
  });

  it('renders the correct cap primitive independently at the start end', () => {
    host.connection.set(makeConnection({ startCap: 'circle' }));
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('circle.wb-connection__cap')).not.toBeNull();

    host.connection.set(makeConnection({ startCap: 'triangle' }));
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('polygon.wb-connection__cap')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('circle.wb-connection__cap')).toBeNull();
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

  it('describes shape and direction in the aria-label for a solid connector (no caps)', () => {
    host.connection.set(makeConnection({ shape: 'curved', lineStyle: 'solid' }));
    fixture.detectChanges();
    expect(hitPath().getAttribute('aria-label')).toBe('Connecteur courbe de Idée 1 vers Idée 2');
  });

  it('mentions "pointillés" (dashed) in the aria-label for a dashed connector', () => {
    host.connection.set(makeConnection({ shape: 'straight', lineStyle: 'dashed' }));
    fixture.detectChanges();
    const label = hitPath().getAttribute('aria-label') ?? '';
    expect(label).toContain('pointillés');
    expect(label).toContain('Idée 1');
    expect(label).toContain('Idée 2');
  });

  it('spells out the start and end caps in the aria-label when a cap is set', () => {
    host.connection.set(makeConnection({ shape: 'curved', lineStyle: 'solid', startCap: 'arrow', endCap: 'diamond' }));
    fixture.detectChanges();
    const label = hitPath().getAttribute('aria-label') ?? '';
    expect(label).toContain('départ : flèche');
    expect(label).toContain('arrivée : losange');
  });

  it('omits the cap suffix from the aria-label when both caps are "none"', () => {
    host.connection.set(makeConnection({ startCap: 'none', endCap: 'none' }));
    fixture.detectChanges();
    expect(hitPath().getAttribute('aria-label')).not.toContain('départ');
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

  // ── Pinned endpoint anchors (ITEM C — user-facing side override) ────────────────

  it('pins the start point to fromAnchor when set, instead of the centre-facing side', () => {
    // FROM_RECT is {0,0,192,128}; its N-edge midpoint is (96,0). Without the override the side
    // facing TO_RECT (down-right) would be E/S, not N.
    host.connection.set(makeConnection({ shape: 'straight', fromAnchor: 'N' }));
    fixture.detectChanges();
    expect(linePath().getAttribute('d')).toContain('M96,0 ');
  });

  it('pins the end point to toAnchor when set', () => {
    // TO_RECT is {400,300,192,128}; its W-edge midpoint is (400,364).
    host.connection.set(makeConnection({ shape: 'straight', toAnchor: 'W' }));
    fixture.detectChanges();
    expect(linePath().getAttribute('d')).toContain('L400,364');
  });

  it('falls back to the centre-facing side when the anchor override is null (backward compat)', () => {
    host.connection.set(makeConnection({ shape: 'straight', fromAnchor: null, toAnchor: null }));
    fixture.detectChanges();
    // TO is down-right of FROM → from anchors on E or S (never the N/W far edges).
    const d = linePath().getAttribute('d') ?? '';
    expect(d.startsWith('M96,0 ')).toBe(false);
  });
});
