import { DOCUMENT } from '@angular/common';
import { Directive, ElementRef, HostListener, OnDestroy, inject, input } from '@angular/core';

/** Delay before a cold tooltip appears — long enough not to fire on a pointer merely crossing. */
const SHOW_DELAY_MS = 400;
/**
 * Once one tooltip has been shown, the group stays "warm" for this long: moving along a toolbar
 * shows the next tooltips instantly instead of re-paying the delay on every button.
 */
const WARM_MS = 1500;

/** Gap between the anchor and the tooltip, in px. */
const OFFSET_PX = 8;

/**
 * Shared across every instance — the warm-up is a property of the *group* of tooltips, not of a
 * single one, which is what makes scanning a toolbar feel instant after the first hover.
 */
let warmUntil = 0;

/**
 * Clears the group warm-up.
 *
 * @internal Exists for tests only: {@link warmUntil} is module state that outlives any fixture, so
 * without this a test that shows a tooltip would leave the next one warm and silently skip its
 * delay.
 */
export function resetWbTooltipWarmup(): void {
  warmUntil = 0;
}

let nextId = 0;

const STYLE_ID = 'wb-tooltip-styles';

/**
 * The tooltip is appended to `<body>`, outside the board's `:host` — so it is out of reach of the
 * `--wb-*` design tokens, which are declared on that host. Hence the literal values below, with
 * the tokens kept as the preferred source when a consumer does expose them higher up.
 */
const STYLES = `
.wb-tooltip {
  position: fixed;
  z-index: 1000;
  display: flex;
  align-items: center;
  gap: 6px;
  max-width: 260px;
  padding: 5px 9px;
  border-radius: 6px;
  background: var(--wb-ink, #1f2130);
  color: var(--wb-surface, #fff);
  font-family: inherit;
  font-size: 12px;
  line-height: 1.4;
  white-space: nowrap;
  pointer-events: none;
  box-shadow: 0 4px 12px rgb(0 0 0 / 25%);
}
.wb-tooltip__key {
  padding: 1px 5px;
  border: 1px solid rgb(255 255 255 / 30%);
  border-radius: 4px;
  font-family: var(--wb-font-mono, ui-monospace, monospace);
  font-size: 11px;
  line-height: 1.3;
}
`;

/**
 * Injects the tooltip stylesheet once per document. Self-injection rather than a global SCSS file
 * because this is a publishable library: a consumer importing the component must not also have to
 * remember to import a stylesheet for its tooltips to be legible.
 */
function ensureStyles(doc: Document): void {
  if (doc.getElementById(STYLE_ID)) {
    return;
  }
  const style = doc.createElement('style');
  style.id = STYLE_ID;
  style.textContent = STYLES;
  doc.head.appendChild(style);
}

/**
 * A tooltip with a controlled delay and content, replacing the native `title`.
 *
 * The native `title` was already present on every toolbar button but is unusable here: the browser
 * decides its ~1s delay and its styling, it never appears on keyboard focus, and it duplicates the
 * `aria-label` for screen-reader users. This directive fixes all four — and lets the label carry
 * the tool's keyboard shortcut.
 *
 * Set `wbTooltip` to the text; add `wbTooltipShortcut` to render a key badge after it.
 *
 * @remarks
 * Deliberately self-contained rather than built on `@angular/cdk`'s overlay: the CDK is not a
 * dependency of this repo (ADR-007 reserves it for `pivot-design-system`, which does not exist
 * yet). **Technical debt** — replace the manual positioning below with `cdk-overlay` once the
 * design-system is publishable.
 */
@Directive({
  selector: '[wbTooltip]',
  standalone: true,
})
export class WbTooltipDirective implements OnDestroy {
  /** Tooltip text. An empty value disables the tooltip entirely. */
  readonly wbTooltip = input<string>('');
  /** Optional shortcut key rendered as a badge after the text (e.g. `V`). */
  readonly wbTooltipShortcut = input<string | null>(null);

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly doc = inject(DOCUMENT);

  private tip: HTMLElement | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly id = `wb-tip-${nextId++}`;

  ngOnDestroy(): void {
    this.hide();
  }

  @HostListener('pointerenter')
  protected onEnter(): void {
    this.schedule();
  }

  /**
   * `click` as well as the pointer events: activating a toggle button (Réduire/Développer, a shape
   * in the fly-out) changes its own label, and a tooltip left open would then describe the state
   * the button just left. `click` — unlike `pointerdown` — also fires for Enter/Space, so keyboard
   * users get the same dismissal.
   */
  @HostListener('pointerleave')
  @HostListener('pointerdown')
  @HostListener('click')
  protected onLeave(): void {
    this.hide();
  }

  /** Keyboard users get the tooltip immediately — a focus is deliberate, it needs no debounce. */
  @HostListener('focus')
  protected onFocus(): void {
    if (this.host.nativeElement.matches(':focus-visible')) {
      this.show();
    }
  }

  @HostListener('blur')
  protected onBlur(): void {
    this.hide();
  }

  private schedule(): void {
    if (this.timer || this.tip) {
      return;
    }
    const delay = Date.now() < warmUntil ? 0 : SHOW_DELAY_MS;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.show();
    }, delay);
  }

  private show(): void {
    const text = this.wbTooltip();
    if (!text || this.tip) {
      return;
    }
    ensureStyles(this.doc);
    const tip = this.doc.createElement('div');
    tip.id = this.id;
    tip.className = 'wb-tooltip';
    // `role="tooltip"` + `aria-describedby` rather than a live region: the tooltip supplements the
    // button's own accessible name, it must not interrupt what the user is doing.
    tip.setAttribute('role', 'tooltip');

    const label = this.doc.createElement('span');
    label.textContent = text;
    tip.appendChild(label);

    const shortcut = this.wbTooltipShortcut();
    if (shortcut) {
      const kbd = this.doc.createElement('kbd');
      kbd.className = 'wb-tooltip__key';
      kbd.textContent = shortcut;
      tip.appendChild(kbd);
    }

    this.doc.body.appendChild(tip);
    this.tip = tip;
    this.host.nativeElement.setAttribute('aria-describedby', this.id);
    this.position(tip);
  }

  /**
   * Places the tooltip to the right of the anchor, vertically centred, flipping to the left when
   * it would overflow the viewport — the toolbar sits against the left edge, so the right side is
   * the natural default.
   */
  private position(tip: HTMLElement): void {
    const anchor = this.host.nativeElement.getBoundingClientRect();
    const box = tip.getBoundingClientRect();
    const flip = anchor.right + OFFSET_PX + box.width > this.doc.documentElement.clientWidth;
    const left = flip ? anchor.left - OFFSET_PX - box.width : anchor.right + OFFSET_PX;
    const top = anchor.top + anchor.height / 2 - box.height / 2;
    tip.style.left = `${Math.max(0, left)}px`;
    tip.style.top = `${Math.max(0, top)}px`;
  }

  private hide(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.tip) {
      // Leaving a shown tooltip warms the group, so the next button in the bar answers instantly.
      warmUntil = Date.now() + WARM_MS;
      this.tip.remove();
      this.tip = null;
      this.host.nativeElement.removeAttribute('aria-describedby');
    }
  }
}
