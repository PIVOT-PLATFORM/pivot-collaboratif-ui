import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WbTooltipDirective, resetWbTooltipWarmup } from './wb-tooltip.directive';

@Component({
  standalone: true,
  imports: [WbTooltipDirective],
  template: `
    <button id="a" type="button" [wbTooltip]="labelA" [wbTooltipShortcut]="shortcutA">A</button>
    <button id="b" type="button" [wbTooltip]="'Note'" [wbTooltipShortcut]="'N'">B</button>
    <button id="c" type="button" [wbTooltip]="''">C</button>
  `,
})
class HostComponent {
  labelA = 'Sélection';
  shortcutA: string | null = 'V';
}

describe('WbTooltipDirective', () => {
  let fixture: ComponentFixture<HostComponent>;

  beforeEach(async () => {
    vi.useFakeTimers();
    // Module-level state that outlives fixtures — a leftover warm-up would skip the delay here.
    resetWbTooltipWarmup();
    await TestBed.configureTestingModule({ imports: [HostComponent] }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
  });

  afterEach(() => {
    fixture.destroy();
    vi.useRealTimers();
    document.querySelectorAll('.wb-tooltip').forEach((el) => el.remove());
    document.getElementById('wb-tooltip-styles')?.remove();
  });

  function btn(id: string): HTMLElement {
    return fixture.nativeElement.querySelector(`#${id}`) as HTMLElement;
  }
  function tips(): NodeListOf<Element> {
    return document.querySelectorAll('.wb-tooltip');
  }

  it('shows nothing before the delay has elapsed', () => {
    btn('a').dispatchEvent(new Event('pointerenter'));
    vi.advanceTimersByTime(399);

    expect(tips()).toHaveLength(0);
  });

  it('shows the label and the shortcut badge once the delay elapses', () => {
    btn('a').dispatchEvent(new Event('pointerenter'));
    vi.advanceTimersByTime(400);

    const tip = tips()[0];
    expect(tip).toBeTruthy();
    expect(tip.textContent).toContain('Sélection');
    expect(tip.querySelector('.wb-tooltip__key')?.textContent).toBe('V');
  });

  it('never shows a tooltip for an empty label', () => {
    btn('c').dispatchEvent(new Event('pointerenter'));
    vi.advanceTimersByTime(1000);

    expect(tips()).toHaveLength(0);
  });

  it('cancels a pending tooltip when the pointer leaves before the delay', () => {
    btn('a').dispatchEvent(new Event('pointerenter'));
    vi.advanceTimersByTime(200);
    btn('a').dispatchEvent(new Event('pointerleave'));
    vi.advanceTimersByTime(1000);

    expect(tips()).toHaveLength(0);
  });

  it('hides the tooltip on pointerdown, so it cannot linger over a click', () => {
    btn('a').dispatchEvent(new Event('pointerenter'));
    vi.advanceTimersByTime(400);
    expect(tips()).toHaveLength(1);

    btn('a').dispatchEvent(new Event('pointerdown'));

    expect(tips()).toHaveLength(0);
  });

  it('links the tooltip to its anchor with aria-describedby while shown, and unlinks on hide', () => {
    btn('a').dispatchEvent(new Event('pointerenter'));
    vi.advanceTimersByTime(400);

    const id = btn('a').getAttribute('aria-describedby');
    expect(id).toBeTruthy();
    expect(document.getElementById(id!)?.getAttribute('role')).toBe('tooltip');

    btn('a').dispatchEvent(new Event('pointerleave'));
    expect(btn('a').hasAttribute('aria-describedby')).toBe(false);
  });

  /**
   * The warm-up is what makes scanning a toolbar feel instant: only the first button pays the
   * delay, the rest answer immediately for a short while after.
   */
  it('shows the next tooltip instantly while the group is warm', () => {
    btn('a').dispatchEvent(new Event('pointerenter'));
    vi.advanceTimersByTime(400);
    btn('a').dispatchEvent(new Event('pointerleave'));

    btn('b').dispatchEvent(new Event('pointerenter'));
    vi.advanceTimersByTime(0);

    expect(tips()[0]?.textContent).toContain('Note');
  });

  it('pays the delay again once the group has gone cold', () => {
    btn('a').dispatchEvent(new Event('pointerenter'));
    vi.advanceTimersByTime(400);
    btn('a').dispatchEvent(new Event('pointerleave'));

    // Past the warm-up window — the bar is cold again.
    vi.advanceTimersByTime(1600);

    btn('b').dispatchEvent(new Event('pointerenter'));
    vi.advanceTimersByTime(0);
    expect(tips()).toHaveLength(0);

    vi.advanceTimersByTime(400);
    expect(tips()).toHaveLength(1);
  });

  it('injects its stylesheet exactly once, however many tooltips are shown', () => {
    btn('a').dispatchEvent(new Event('pointerenter'));
    vi.advanceTimersByTime(400);
    btn('a').dispatchEvent(new Event('pointerleave'));
    btn('b').dispatchEvent(new Event('pointerenter'));
    vi.advanceTimersByTime(400);

    expect(document.querySelectorAll('#wb-tooltip-styles')).toHaveLength(1);
  });

  it('removes a shown tooltip when the host is destroyed, leaving nothing orphaned in the body', () => {
    btn('a').dispatchEvent(new Event('pointerenter'));
    vi.advanceTimersByTime(400);
    expect(tips()).toHaveLength(1);

    fixture.destroy();

    expect(tips()).toHaveLength(0);
  });

  /** A toggle button relabels itself when activated; a tooltip left open would describe the state
   *  it just left. `click` also covers Enter/Space, which fire no pointer event. */
  it('hides on click, so a toggle button cannot keep a tooltip describing its old state', () => {
    btn('a').dispatchEvent(new Event('pointerenter'));
    vi.advanceTimersByTime(400);
    expect(tips()).toHaveLength(1);

    btn('a').dispatchEvent(new Event('click'));

    expect(tips()).toHaveLength(0);
  });

  it('omits the key badge when the tool has no shortcut', () => {
    fixture.componentInstance.shortcutA = null;
    fixture.detectChanges();

    btn('a').dispatchEvent(new Event('pointerenter'));
    vi.advanceTimersByTime(400);

    expect(tips()[0]?.querySelector('.wb-tooltip__key')).toBeNull();
  });
});
