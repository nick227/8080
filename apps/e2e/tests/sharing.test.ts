import { test, expect } from '@playwright/test';

test.describe('Multi-Room Sharing', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate and login
    await page.goto('/room/test2');
    await expect(page.locator('text=Join as Guest').or(page.locator('[aria-label="Microphone"]'))).toBeVisible();
    if (await page.locator('text=Join as Guest').isVisible()) {
      await page.locator('text=Join as Guest').click();
    }
    // Now navigate to the main room for the test
    await page.goto('/room/demo');
  });

  test('can share a new message to another room', async ({ page, context }) => {
    test.skip(); // Share button was removed from Room items in new Chat UI
    // We need two rooms. The user starts in the default room.
    // In our app, there is a global feed or specific rooms. Let's assume we are on the global feed or a default room.
    
    const mediumBtn = page.locator('button', { hasText: 'Medium' });
    if (await mediumBtn.isVisible()) await mediumBtn.click();

    // 1. Create a text message
    await page.getByPlaceholder('Message').fill('E2E Share Test Message');
    await page.getByRole('button', { name: 'Send' }).click();

    // 2. Wait for it to appear in the feed
    const itemText = page.locator('text=E2E Share Test Message').first();
    await expect(itemText).toBeVisible();
    
    // Find the item container and its SHARE button
    const itemPanel = page.locator('article', { hasText: 'E2E Share Test Message' }).first();
    const shareBtn = itemPanel.locator('button[aria-label^="Share item"]');
    await shareBtn.click({ force: true });

    // 3. Select another room
    const shareMenu = itemPanel.locator('.share-menu');
    await expect(shareMenu).toBeVisible();
    
    // Click on the first unchecked, non-disabled room control
    const unselectedRoom = shareMenu.locator('button:not([disabled]):has-text("○")').first();
    // Only proceed if there is another room available to share to
    if (await unselectedRoom.isVisible()) {
      await unselectedRoom.click();

      // The primary button should update its text
      const shareSubmitBtn = shareMenu.locator('button', { hasText: /SHARE TO/ });
      await expect(shareSubmitBtn).toBeEnabled();
      await shareSubmitBtn.click();

      // 4. Menu should close on success
      await expect(shareMenu).not.toBeVisible();
    }
  });
});
