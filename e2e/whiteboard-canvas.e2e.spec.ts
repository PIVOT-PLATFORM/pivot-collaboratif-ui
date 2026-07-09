import { test, expect } from './fixtures';
import { Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/**
 * E2E coverage for `WhiteboardCanvasComponent` (US08.3.2a) — previously this component had
 * *no* Playwright spec at all despite the repo's own Gate 4 rubric requiring "happy path + at
 * least 1 critical error case" (`.project/skills/skill-pr-reviewer.yaml` /
 * `skill-testing-strategy.yaml`).
 *
 * Runs against a real `pivot-collaboratif-core` backend (see `.github/workflows/e2e.yml`) — the
 * board list/create/access-guard flow all make real HTTP calls, so this spec cannot be exercised
 * against a static/mocked page. Locators are semantic (`getByRole`/`getByLabel`, matching this
 * repo's actual accessibility markup) rather than `data-testid`, consistent with the rest of this
 * codebase (no `data-testid` attributes are used anywhere in `projects/collaboratif-ui`).
 *
 * Canvas objects are HTML5 Canvas 2D drawings, not DOM nodes — presence/position is verified by
 * sampling actual rendered pixels via `canvas.getContext('2d').getImageData()` rather than DOM
 * queries. The default stroke colour (`#1a1a2e`, near-black) against the light canvas background
 * makes "ink present near (x, y)" an unambiguous, low-flakiness signal; shapes are drawn unfilled
 * (no UI control for fill colour exists — see `WhiteboardCanvasComponent.fillColor`), so only the
 * border is ever sampled, never the interior.
 */

/**
 * Returns true if any pixel in a small square around (x, y) is "ink" (dark), not background.
 *
 * <p>(x, y) are page-relative viewport coordinates — the same space {@link dragOnCanvas} and
 * every caller already use via `origin.x + localOffset` — converted here to the canvas's own
 * coordinate space before sampling: `getImageData` reads relative to the canvas element's own
 * top-left, not the page's (a toolbar sits above the canvas, so they diverge). Deliberately
 * *no* bitmap/CSS size-ratio scaling here, even though `canvas.width`/`height` don't match its
 * CSS-rendered size 1:1 on this component (observed drift: 638px bitmap height vs 675px CSS
 * height) — `WhiteboardCanvasComponent`'s own drawing math (`event.clientX - rect.left`,
 * `whiteboard-canvas.component.ts`) uses that same unscaled offset directly as its 2D-context
 * drawing coordinate, so matching it here (not "correcting" it) is what actually lands on the
 * real ink.
 *
 * <p>Default radius widened from 4 to 10: an unfilled rectangle's stroke anti-aliases at its
 * corners, so the exact geometric corner point can land a few px short of any actually-painted
 * pixel (observed: nearest ink ~6px away along each edge) — a real rendering nuance, not a
 * position bug, and not worth chasing to the pixel for a happy-path E2E assertion.
 */
async function hasInkNear(page: Page, x: number, y: number, radius = 10): Promise<boolean> {
  return page.evaluate(
    ({ x, y, radius }) => {
      const canvas = document.querySelector('canvas.wb-canvas') as HTMLCanvasElement;
      const rect = canvas.getBoundingClientRect();
      const canvasX = x - rect.left;
      const canvasY = y - rect.top;
      const ctx = canvas.getContext('2d')!;
      const size = radius * 2;
      const left = Math.max(0, Math.round(canvasX - radius));
      const top = Math.max(0, Math.round(canvasY - radius));
      const data = ctx.getImageData(left, top, size, size).data;
      for (let i = 0; i < data.length; i += 4) {
        const [r, g, b, a] = [data[i], data[i + 1], data[i + 2], data[i + 3]];
        if (a > 0 && r + g + b < 300) return true; // dark pixel — default stroke is #1a1a2e
      }
      return false;
    },
    { x, y, radius },
  );
}

/** Drags from one canvas-local point to another via real pointer events. */
/**
 * Drags from one canvas-local point to another via real pointer events.
 *
 * <p>Settles briefly after `mouseup` before returning. `WhiteboardCanvasComponent`'s own
 * `pointerdown` handler hit-tests the position it was rendered at on the *previous* frame
 * (`hitTestHandle`/`findHit`, driven by Angular signals) — chaining two drags back-to-back with
 * no gap risks a resize/select mousedown landing before a prior move/resize's re-render (and
 * therefore its handle positions) has actually flushed, silently missing the handle and falling
 * through to the "clicked empty canvas" branch, which clears the selection instead. Confirmed by
 * running the full happy-path sequence 6× locally: ~1-in-6 intermittent failures, traced to the
 * `Dupliquer` toolbar button's `disabled` attribute (mirrors `hasSelection()`) flipping true
 * right after the resize step — i.e. selection was genuinely lost, not a pixel-sampling flake.
 */
async function dragOnCanvas(
  page: Page,
  origin: { x: number; y: number },
  from: [number, number],
  to: [number, number],
): Promise<void> {
  await page.mouse.move(origin.x + from[0], origin.y + from[1]);
  await page.mouse.down();
  await page.mouse.move(origin.x + to[0], origin.y + to[1], { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(100);
}

/** Creates a blank board via the board-list UI and waits for navigation into it. Returns the
 *  canvas element's page-relative origin (top-left), so subsequent coordinates can stay
 *  toolbar/viewport-agnostic. */
async function createBoardAndGetCanvasOrigin(
  page: Page,
  title: string,
): Promise<{ x: number; y: number }> {
  await page.goto('/whiteboard');
  await page.getByRole('button', { name: 'Nouveau tableau' }).click();
  await page.getByLabel('Titre du tableau').fill(title);
  await page.getByRole('button', { name: 'Créer' }).click();
  await expect(page).toHaveURL(/\/whiteboard\/[^/]+$/);

  // The read-only banner (`WhiteboardCanvasComponent`, `@if (readOnly())`) is visible while the
  // STOMP connection is still opening and disappears once connected — a real layout shift, not
  // test flakiness. Wait for it to be gone before measuring the canvas's bounding box, otherwise
  // drag coordinates computed from a pre-shift origin land on the wrong pixels once the banner
  // collapses mid-test.
  await expect(page.getByRole('status').filter({ hasText: /lecture seule/i })).toBeHidden();

  const canvas = page.locator('canvas.wb-canvas');
  await expect(canvas).toBeVisible();
  const box = await canvas.boundingBox();
  if (!box) throw new Error('whiteboard canvas has no bounding box');
  return { x: box.x, y: box.y };
}

test.describe('Whiteboard canvas — happy path (US08.3.2a)', () => {
  test('draw a shape, select it, move it, resize it, duplicate it, undo/redo', async ({ page }) => {
    const origin = await createBoardAndGetCanvasOrigin(page, `E2E canvas ${Date.now()}`);

    // 1. Draw a rectangle: select the tool, drag on the canvas.
    await page.getByRole('button', { name: /Outil rectangle/ }).click();
    await dragOnCanvas(page, origin, [150, 150], [300, 250]);
    expect(await hasInkNear(page, origin.x + 150, origin.y + 150)).toBe(true);
    expect(await hasInkNear(page, origin.x + 300, origin.y + 250)).toBe(true);

    // 2. Switch to the select tool and select the shape (auto-selected after drawing, but a
    // click on it exercises the real select/hit-test path too).
    await page.getByRole('button', { name: /Outil sélection/ }).click();
    await page.mouse.click(origin.x + 225, origin.y + 150); // top edge, unambiguously inside hit area

    // 3. Move it: drag from inside the shape to a new location, +200 on x.
    await dragOnCanvas(page, origin, [225, 200], [425, 200]);
    expect(await hasInkNear(page, origin.x + 150, origin.y + 150)).toBe(false); // old corner: gone
    expect(await hasInkNear(page, origin.x + 350, origin.y + 150)).toBe(true); // new corner: present

    // 4. Resize it: drag the bottom-right handle outward — a real per-handle resize, not a move
    // (US08.3.2a Gate 4 gap fix). Handle centre ≈ (rect.x + rect.width + 4, rect.y + rect.height + 4).
    await dragOnCanvas(page, origin, [504, 254], [584, 314]);
    expect(await hasInkNear(page, origin.x + 350, origin.y + 150)).toBe(true); // anchor corner: unchanged
    expect(await hasInkNear(page, origin.x + 580, origin.y + 310)).toBe(true); // grew this far out

    // 5. Duplicate it (Ctrl+D) — copy offset by +16/+16. Since shapes are unfilled (border-only),
    // the duplicate's own top-left corner sits strictly inside the original's hollow body, so
    // ink there can only come from the copy's border.
    //
    // Keyboard shortcuts (Ctrl+D/Z/Y) return as soon as the event dispatches — unlike the mouse
    // drags above, which take several real pointer-move steps and so incidentally give the
    // canvas time to repaint before the next assertion, a keyboard action can race ahead of the
    // app's own (signal-driven) redraw. `expect.poll` retries the pixel sample instead of
    // asserting once immediately after the keypress.
    await page.keyboard.press('Control+d');
    await expect.poll(() => hasInkNear(page, origin.x + 366, origin.y + 166)).toBe(true);

    // 6. Undo removes the duplicate; redo brings it back.
    await page.keyboard.press('Control+z');
    await expect.poll(() => hasInkNear(page, origin.x + 366, origin.y + 166)).toBe(false);
    await page.keyboard.press('Control+y');
    await expect.poll(() => hasInkNear(page, origin.x + 366, origin.y + 166)).toBe(true);
  });

  test('AC-canvas-a11y-01: whiteboard canvas page has no axe-core violations', async ({ page }) => {
    await createBoardAndGetCanvasOrigin(page, `E2E a11y ${Date.now()}`);
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
  });
});

test.describe('Whiteboard canvas — critical error case', () => {
  test('opening a board the user has no access to redirects back to the board list', async ({ page }) => {
    // boardAccessGuard fails closed on 403/404/network error (board-access.guard.ts) — a
    // well-formed but non-existent board id always 404s.
    await page.goto('/whiteboard/00000000-0000-0000-0000-000000000000');
    await expect(page).toHaveURL(/\/whiteboard$/);
    await expect(page.getByRole('heading', { name: 'Mes tableaux' })).toBeVisible();
  });
});
