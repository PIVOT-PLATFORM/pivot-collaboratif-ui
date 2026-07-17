import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslocoTestingModule } from '@jsverse/transloco';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ShortcutsPanelComponent } from './shortcuts-panel.component';
import { SHORTCUT_BY_TOOL } from '../model/tools';

const FR = {
  whiteboard: {
    toolbar: { select: 'Sélection', pan: 'Main', sticky: 'Note' },
    shortcuts: {
      title: 'Raccourcis clavier',
      close: 'Fermer les raccourcis',
      groupTools: 'Outils',
      groupEdit: 'Édition',
      groupCanvas: 'Navigation et gestes',
      copy: 'Copier',
      ratio: 'Conserver le ratio au redimensionnement',
      keys: { ctrl: 'Ctrl', shift: 'Maj', alt: 'Alt', drag: 'glisser' },
    },
  },
};

describe('ShortcutsPanelComponent', () => {
  let fixture: ComponentFixture<ShortcutsPanelComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [
        ShortcutsPanelComponent,
        TranslocoTestingModule.forRoot({
          langs: { fr: FR },
          translocoConfig: { defaultLang: 'fr', availableLangs: ['fr'] },
          preloadLangs: true,
        }),
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(ShortcutsPanelComponent);
    fixture.detectChanges();
  });

  afterEach(() => fixture.destroy());

  function el(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  it('renders as a modal dialog, so assistive tech treats the board behind it as inert', () => {
    const dialog = el().querySelector('[role="dialog"]');

    expect(dialog?.getAttribute('aria-modal')).toBe('true');
    expect(dialog?.getAttribute('aria-label')).toBe('Raccourcis clavier');
  });

  /** The rows are derived from `SHORTCUT_BY_TOOL`, so the sheet cannot advertise a key the
   *  handler does not bind. This asserts the derivation, not a hard-coded copy. */
  it('advertises each tool with the key the handler actually binds', () => {
    const rows = Array.from(el().querySelectorAll('.wb-shortcuts__row'));
    const selectRow = rows.find((r) => r.querySelector('.wb-shortcuts__label')?.textContent === 'Sélection');

    expect(selectRow?.querySelector('.wb-shortcuts__key')?.textContent).toBe(SHORTCUT_BY_TOOL['select']);
  });

  it('translates named keys rather than hard-coding a locale', () => {
    const rows = Array.from(el().querySelectorAll('.wb-shortcuts__row'));
    const copy = rows.find((r) => r.querySelector('.wb-shortcuts__label')?.textContent === 'Copier');
    const keys = Array.from(copy?.querySelectorAll('.wb-shortcuts__key') ?? []).map((k) => k.textContent);

    // "Ctrl" comes from i18n, "C" is a verbatim letter — both render side by side.
    expect(keys).toEqual(['Ctrl', 'C']);
  });

  it('documents the resize modifiers, which have no button to discover them from', () => {
    const rows = Array.from(el().querySelectorAll('.wb-shortcuts__row'));
    const ratio = rows.find(
      (r) => r.querySelector('.wb-shortcuts__label')?.textContent === 'Conserver le ratio au redimensionnement',
    );
    const keys = Array.from(ratio?.querySelectorAll('.wb-shortcuts__key') ?? []).map((k) => k.textContent);

    expect(keys).toEqual(['Maj', 'glisser']);
  });

  it('emits closePanel when the close button is pressed', () => {
    const closed = vi.fn();
    fixture.componentInstance.closePanel.subscribe(closed);

    (el().querySelector('.wb-shortcuts__close') as HTMLButtonElement).click();

    expect(closed).toHaveBeenCalledTimes(1);
  });

  it('emits closePanel on a backdrop click', () => {
    const closed = vi.fn();
    fixture.componentInstance.closePanel.subscribe(closed);

    (el().querySelector('.wb-shortcuts__backdrop') as HTMLElement).dispatchEvent(
      new MouseEvent('click', { bubbles: true }),
    );

    expect(closed).toHaveBeenCalledTimes(1);
  });

  /** A click that merely bubbles up from inside the dialog must not read as "dismiss". */
  it('does not close when the click started inside the dialog', () => {
    const closed = vi.fn();
    fixture.componentInstance.closePanel.subscribe(closed);

    (el().querySelector('.wb-shortcuts__title') as HTMLElement).dispatchEvent(
      new MouseEvent('click', { bubbles: true }),
    );

    expect(closed).not.toHaveBeenCalled();
  });

  it('wraps Tab from the last focusable back to the first, keeping focus inside the dialog', () => {
    const buttons = Array.from(el().querySelectorAll('button'));
    const last = buttons[buttons.length - 1];
    last.focus();
    const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true });
    const prevented = vi.spyOn(event, 'preventDefault');

    last.dispatchEvent(event);

    expect(prevented).toHaveBeenCalled();
    expect(document.activeElement).toBe(buttons[0]);
  });

  it('wraps Shift+Tab from the first focusable back to the last', () => {
    const buttons = Array.from(el().querySelectorAll('button'));
    const first = buttons[0];
    first.focus();

    first.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true }));

    expect(document.activeElement).toBe(buttons[buttons.length - 1]);
  });
});
