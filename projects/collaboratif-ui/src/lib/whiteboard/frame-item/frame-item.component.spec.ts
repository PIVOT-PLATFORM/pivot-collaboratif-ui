import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslocoTestingModule } from '@jsverse/transloco';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FrameItemComponent } from './frame-item.component';
import type { Frame } from '../model/board.types';

const FR = {
  whiteboard: {
    frame: {
      titleLabel: 'Titre du cadre',
      untitled: 'Cadre sans titre',
      carryCards: 'Emporter les cartes du cadre',
      delete: 'Supprimer le cadre « {{title}} »',
    },
    layer: {
      bringToFront: 'Premier plan',
      sendToBack: 'Arrière-plan',
    },
  },
};

function makeFrame(overrides: Partial<Frame> = {}): Frame {
  return {
    id: 'frame-1',
    boardId: 'board-1',
    title: '',
    posX: 0,
    posY: 0,
    width: 400,
    height: 300,
    color: '#CBD5E1',
    active: false,
    layer: 1,
    ...overrides,
  };
}

describe('FrameItemComponent', () => {
  let fixture: ComponentFixture<FrameItemComponent>;
  let component: FrameItemComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [
        FrameItemComponent,
        TranslocoTestingModule.forRoot({
          langs: { fr: FR },
          translocoConfig: { defaultLang: 'fr', availableLangs: ['fr'] },
          preloadLangs: true,
        }),
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(FrameItemComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('frame', makeFrame());
    fixture.detectChanges();
  });

  function btn(label: string): HTMLButtonElement | undefined {
    return Array.from(fixture.nativeElement.querySelectorAll('button')).find((b) =>
      (b as HTMLButtonElement).getAttribute('aria-label')?.startsWith(label),
    ) as HTMLButtonElement | undefined;
  }

  // US08.8.1 — the visible affordance for deleting a frame. `Suppr` on a selected frame already
  // worked, but nothing on the frame hinted that deleting one was possible at all.
  it('emits remove when the delete button is clicked', () => {
    const removed = vi.fn();
    component.remove.subscribe(removed);

    btn('Supprimer le cadre')!.click();

    expect(removed).toHaveBeenCalledTimes(1);
  });

  it('labels the delete button with the frame title, falling back to the untitled label', () => {
    expect(btn('Supprimer le cadre')!.getAttribute('aria-label')).toContain('Cadre sans titre');

    fixture.componentRef.setInput('frame', makeFrame({ title: 'Zone Recette' }));
    fixture.detectChanges();
    expect(btn('Supprimer le cadre')!.getAttribute('aria-label')).toContain('Zone Recette');
  });

  it('hides every action, including delete, in read-only mode', () => {
    fixture.componentRef.setInput('readOnly', true);
    fixture.detectChanges();

    expect(btn('Supprimer le cadre')).toBeUndefined();
    expect(btn('Premier plan')).toBeUndefined();
    expect(btn('Emporter')).toBeUndefined();
  });

  it('emits the layer actions from their buttons', () => {
    const front = vi.fn();
    const back = vi.fn();
    component.bringToFront.subscribe(front);
    component.sendToBack.subscribe(back);

    btn('Premier plan')!.click();
    btn('Arrière-plan')!.click();

    expect(front).toHaveBeenCalledTimes(1);
    expect(back).toHaveBeenCalledTimes(1);
  });

  it('renders the resize handles only once the frame is selected (they are what makes it resizable)', () => {
    expect(fixture.nativeElement.querySelectorAll('[data-frame-resize-dir]').length).toBe(0);

    fixture.componentRef.setInput('selected', true);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('[data-frame-resize-dir]').length).toBeGreaterThan(0);
  });

  it('commits an edited title on Enter', () => {
    const committed = vi.fn();
    component.titleCommit.subscribe(committed);

    (fixture.nativeElement.querySelector('.wb-frame__title') as HTMLElement).dispatchEvent(
      new MouseEvent('dblclick', { bubbles: true }),
    );
    fixture.detectChanges();

    const input = fixture.nativeElement.querySelector('.wb-frame__title-edit') as HTMLInputElement;
    input.value = 'Zone Recette';
    input.dispatchEvent(new Event('input'));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    expect(committed).toHaveBeenCalledWith('Zone Recette');
  });
});
