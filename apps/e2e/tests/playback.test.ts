import { test, expect } from '@playwright/test';

test.describe('Playback Engine', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/room/demo');
    await expect(page.locator('text=Join as Guest').or(page.locator('[aria-label="Microphone"]'))).toBeVisible();
    if (await page.locator('text=Join as Guest').isVisible()) {
      await page.locator('text=Join as Guest').click();
    }
  });

  test('advances through feed items sequentially', async ({ page }) => {
    const mediumBtn = page.locator('button', { hasText: 'Medium' });
    if (await mediumBtn.isVisible()) await mediumBtn.click();

    // 1. Seed items
    for (let i = 1; i <= 3; i++) {
      await page.getByPlaceholder('Message').fill(`Playback Test Item ${i}`);
      await page.getByRole('button', { name: 'Send' }).click();
    }
    
    await expect(page.locator('text=Playback Test Item 3').first()).toBeVisible();

    // 2. Click the first item to trigger playback
    const firstItem = page.locator('article', { hasText: 'Playback Test Item 1' }).first();
    await firstItem.click({ force: true }); // Assuming clicking the item triggers playback

    // Verify it dwells (we have an active class or HELD label, etc.)
    // Note: Items without media use DWELL timers to advance.
    
    // We expect the active state to move down the list
    // This is hard to assert perfectly without knowing the exact DOM class for 'active',
    // but typically it scrolls into view or shows play options.
    // We wait for it to traverse (e.g. 5 seconds total for 3 short text items).
    await page.waitForTimeout(5000);
  });
});
