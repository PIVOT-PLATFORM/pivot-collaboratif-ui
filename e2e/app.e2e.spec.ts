import { test, expect } from './fixtures';

test('app loads', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL('/');
});
