import { test, expect } from '@playwright/test';

test.describe('Multi-Room Sharing', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate and login
    await page.goto('/room/test2');
    const joinButton = page.locator('text=Join as Guest');
    if (await joinButton.isVisible()) {
      await joinButton.click();
    }
    // Now navigate to the main room for the test
    await page.goto('/room/demo');
  });

  test('can share a new message to another room', async ({ page, context }) => {
    // We need two rooms. The user starts in the default room.
    // In our app, there is a global feed or specific rooms. Let's assume we are on the global feed or a default room.
    
    // 1. Create a text message
    await page.locator('button:has-text("Aa")').click();
    await page.locator('textarea[placeholder="Write something."]').fill('E2E Share Test Message');
    await page.locator('button:has-text("Send")').click();

    // 2. Wait for it to appear in the feed
    const itemText = page.locator('text=E2E Share Test Message').first();
    await expect(itemText).toBeVisible();
    
    // Find the item container and its SHARE button
    const itemPanel = page.locator('article.item').filter({ hasText: 'E2E Share Test Message' }).first();
    const shareBtn = itemPanel.locator('button:has-text("SHARE")');
    await shareBtn.click();

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
