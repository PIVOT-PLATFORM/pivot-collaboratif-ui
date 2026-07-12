import { test, expect } from './fixtures';
import { Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/**
 * E2E coverage for the structured whiteboard board (PouetPouet port). The board list /
 * create / access-guard flow makes real HTTP calls against a live `pivot-collaboratif-core`
 * backend (see `.github/workflows/e2e.yml`), so this spec cannot run against a static page.
 * Locators stay semantic (`getByRole`/`getByLabel`), matching this repo's accessibility markup.
 *
 * Unlike the former freeform canvas (an HTML5 `<canvas>` sampled pixel-by-pixel), the structured
 * board renders plain DOM/SVG. Board *content* mutations (create card/connection/frame) are
 * optimistic-via-echo: the client emits a STOMP action and only materialises the object when the
 * server broadcasts it back. The Socle backend does not yet implement those structured actions
 * (only shape/text/image + presence — see the port EPIC), so this spec asserts what genuinely
 * works today: the board opens, the structured surface + tool palette render and are operable,
 * and the access guard fails closed. Content round-trip is deferred with the backend work.
 */

/** Creates a blank board via the board-list UI and waits until the structured surface is shown. */
async function createBoardAndOpen(page: Page, title: string): Promise<void> {
  await page.goto('/whiteboard');
  await page.getByRole('button', { name: 'Nouveau tableau' }).click();
  await page.getByLabel('Titre du tableau').fill(title);
  await page.getByRole('button', { name: 'Créer' }).click();
  await expect(page).toHaveURL(/\/whiteboard\/[^/]+$/);
  // The structured canvas host exposes role="application" (see StructuredCanvasComponent).
  await expect(page.getByRole('application')).toBeVisible();
}

test.describe('Whiteboard structured board — happy path', () => {
  test('opens the board and lets a drawing tool be selected from the palette', async ({ page }) => {
    await createBoardAndOpen(page, `E2E board ${Date.now()}`);

    // The floating tool palette renders (role="toolbar").
    await expect(page.getByRole('toolbar')).toBeVisible();

    // Selecting a tool flips its pressed state — exercises the real toolbar → canvas tool wiring.
    const rectangle = page.getByRole('button', { name: 'Rectangle' });
    await expect(rectangle).toBeVisible();
    await rectangle.click();
    await expect(rectangle).toHaveAttribute('aria-pressed', 'true');

    // Undo starts disabled (empty history) — a stable, backend-independent signal.
    await expect(page.getByRole('button', { name: 'Annuler (Ctrl+Z)' })).toBeDisabled();
  });

  test('AC-board-a11y-01: structured board page has no WCAG A/AA axe-core violations', async ({ page }) => {
    await createBoardAndOpen(page, `E2E a11y ${Date.now()}`);
    // Scoped to enforceable WCAG 2.0/2.1 A & AA success criteria (contrast, names, roles) —
    // not axe "best-practice" heuristics (e.g. landmark uniqueness), which a full app shell can
    // trip independently of this feature.
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    expect(results.violations).toEqual([]);
  });
});

test.describe('Whiteboard board — critical error case', () => {
  test('opening a board the user has no access to redirects back to the board list', async ({ page }) => {
    // boardAccessGuard fails closed on 403/404/network error (board-access.guard.ts) — a
    // well-formed but non-existent board id always 404s.
    await page.goto('/whiteboard/00000000-0000-0000-0000-000000000000');
    await expect(page).toHaveURL(/\/whiteboard$/);
    await expect(page.getByRole('heading', { name: 'Mes tableaux' })).toBeVisible();
  });
});
