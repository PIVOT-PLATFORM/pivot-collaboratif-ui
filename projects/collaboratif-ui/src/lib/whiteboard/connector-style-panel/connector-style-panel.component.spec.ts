import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslocoTestingModule } from '@jsverse/transloco';
import { describe, it, expect, beforeEach } from 'vitest';
import { ConnectorStylePanelComponent } from './connector-style-panel.component';
import type { Connection, ConnectionPatch } from '../model/board.types';

const FR_TRANSLATIONS = {
  whiteboard: {
    connector: {
      style: {
        title: 'Style du connecteur',
        shapeLabel: 'Forme',
        shape: { straight: 'Droit', curved: 'Courbe', orthogonal: 'Orthogonal' },
        lineStyleLabel: 'Style de trait',
        lineStyle: { solid: 'Plein', dashed: 'Tirets', dotted: 'Pointillé' },
        startCapLabel: 'Tête (départ)',
        endCapLabel: 'Queue (arrivée)',
        cap: { none: 'Aucune', arrow: 'Flèche', triangle: 'Triangle', circle: 'Cercle', diamond: 'Losange' },
        widthLabel: 'Épaisseur',
        colorLabel: 'Couleur',
        labelFieldLabel: 'Étiquette',
        labelPlaceholder: 'Texte du connecteur',
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

@Component({
  standalone: true,
  imports: [ConnectorStylePanelComponent],
  template: `<wb-connector-style-panel [connection]="connection()" (styleChange)="onChange($event)" />`,
})
class HostComponent {
  readonly connection = signal<Connection>(makeConnection());
  patches: ConnectionPatch[] = [];

  onChange(patch: ConnectionPatch): void {
    this.patches.push(patch);
  }
}

describe('ConnectorStylePanelComponent (US08.7.2)', () => {
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

  function shapeSelect(): HTMLSelectElement {
    return fixture.nativeElement.querySelector('#wbConnStyleShape') as HTMLSelectElement;
  }
  function lineStyleSelect(): HTMLSelectElement {
    return fixture.nativeElement.querySelector('#wbConnStyleLineStyle') as HTMLSelectElement;
  }
  function startCapSelect(): HTMLSelectElement {
    return fixture.nativeElement.querySelector('#wbConnStyleStartCap') as HTMLSelectElement;
  }
  function endCapSelect(): HTMLSelectElement {
    return fixture.nativeElement.querySelector('#wbConnStyleEndCap') as HTMLSelectElement;
  }
  function widthInput(): HTMLInputElement {
    return fixture.nativeElement.querySelector('#wbConnStyleWidth') as HTMLInputElement;
  }
  function colorInput(): HTMLInputElement {
    return fixture.nativeElement.querySelector('#wbConnStyleColor') as HTMLInputElement;
  }
  function labelInput(): HTMLInputElement {
    return fixture.nativeElement.querySelector('#wbConnStyleLabel') as HTMLInputElement;
  }

  // ── A11y: native controls, explicit <label for> ────────────────────────────

  it('associates every control with an explicit <label for>', () => {
    const labels = fixture.nativeElement.querySelectorAll('label[for]') as NodeListOf<HTMLLabelElement>;
    const forIds = Array.from(labels).map((l) => l.getAttribute('for'));
    expect(forIds).toEqual(
      expect.arrayContaining([
        'wbConnStyleShape',
        'wbConnStyleLineStyle',
        'wbConnStyleStartCap',
        'wbConnStyleEndCap',
        'wbConnStyleWidth',
        'wbConnStyleColor',
        'wbConnStyleLabel',
      ]),
    );
  });

  it('uses native <select>/<input> controls (Tab/keyboard operable, no custom widget)', () => {
    expect(shapeSelect().tagName).toBe('SELECT');
    expect(lineStyleSelect().tagName).toBe('SELECT');
    expect(startCapSelect().tagName).toBe('SELECT');
    expect(endCapSelect().tagName).toBe('SELECT');
    expect(widthInput().getAttribute('type')).toBe('number');
    expect(colorInput().getAttribute('type')).toBe('color');
    expect(labelInput().getAttribute('type')).toBe('text');
  });

  it('reflects the current connection values in each control', () => {
    host.connection.set(
      makeConnection({ shape: 'orthogonal', lineStyle: 'dotted', startCap: 'arrow', endCap: 'diamond', width: 6, label: 'hello' }),
    );
    fixture.detectChanges();

    expect(shapeSelect().value).toBe('orthogonal');
    expect(lineStyleSelect().value).toBe('dotted');
    expect(startCapSelect().value).toBe('arrow');
    expect(endCapSelect().value).toBe('diamond');
    expect(widthInput().value).toBe('6');
    expect(labelInput().value).toBe('hello');
  });

  // ── Emission: one field at a time (AC1/AC2 partial patch) ──────────────────

  it('emits only {shape} when the shape select changes', () => {
    shapeSelect().value = 'straight';
    shapeSelect().dispatchEvent(new Event('change'));

    expect(host.patches).toEqual([{ shape: 'straight' }]);
  });

  it('emits only {lineStyle} when the line-style select changes', () => {
    lineStyleSelect().value = 'dashed';
    lineStyleSelect().dispatchEvent(new Event('change'));

    expect(host.patches).toEqual([{ lineStyle: 'dashed' }]);
  });

  it('emits only {startCap} when the start-cap select changes', () => {
    startCapSelect().value = 'triangle';
    startCapSelect().dispatchEvent(new Event('change'));

    expect(host.patches).toEqual([{ startCap: 'triangle' }]);
  });

  it('emits only {endCap} when the end-cap select changes', () => {
    endCapSelect().value = 'circle';
    endCapSelect().dispatchEvent(new Event('change'));

    expect(host.patches).toEqual([{ endCap: 'circle' }]);
  });

  it('emits only {width} when the width input changes', () => {
    widthInput().value = '8';
    widthInput().dispatchEvent(new Event('change'));

    expect(host.patches).toEqual([{ width: 8 }]);
  });

  it('emits only {color} when the color input changes', () => {
    colorInput().value = '#ff0000';
    colorInput().dispatchEvent(new Event('change'));

    expect(host.patches).toEqual([{ color: '#ff0000' }]);
  });

  it('emits only {label} with the trimmed text when the label input changes', () => {
    labelInput().value = '  New label  ';
    labelInput().dispatchEvent(new Event('change'));

    expect(host.patches).toEqual([{ label: 'New label' }]);
  });

  // ── label:null vs undefined (AC3) ───────────────────────────────────────────

  it('emits an explicit {label: null} when the label input is cleared to blank', () => {
    host.connection.set(makeConnection({ label: 'existing' }));
    fixture.detectChanges();

    labelInput().value = '   ';
    labelInput().dispatchEvent(new Event('change'));

    expect(host.patches).toEqual([{ label: null }]);
    expect(host.patches[0]).toHaveProperty('label', null);
  });
});
