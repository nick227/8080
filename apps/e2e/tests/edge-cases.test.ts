import { test, expect } from '@playwright/test';

test.describe('Capture Edge Cases', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/room/demo');
    const joinButton = page.locator('text=Join as Guest');
    if (await joinButton.isVisible()) {
      await joinButton.click();
    }
    const record = page.getByRole('button', { name: 'Record', exact: true });
    if (await record.isVisible()) await record.click();
  });

  test('camera flip toggle updates local storage', async ({ page }) => {
    // Open video capture by clicking ◉
    const videoBtn = page.locator('button', { hasText: '◉' });
    await expect(videoBtn).toBeVisible();
    
    // Check initial flip state (default is 'user' or null)
    let facing = await page.evaluate(() => localStorage.getItem('camera_facing'));
    expect(facing === null || facing === 'user').toBeTruthy();

    // Click flip camera button
    const flipBtn = page.locator('button[title="Flip Camera"]');
    await expect(flipBtn).toBeVisible();
    await flipBtn.click();

    // Verify local storage is updated to 'environment'
    facing = await page.evaluate(() => localStorage.getItem('camera_facing'));
    expect(facing).toBe('environment');

    // Click again to revert
    await flipBtn.click();
    facing = await page.evaluate(() => localStorage.getItem('camera_facing'));
    expect(facing).toBe('user');
  });

  test('upload failure shows retry UI', async ({ page }) => {
    // Intercept uploads and force failure
    await page.route('**/media*', route => {
      route.abort('internetdisconnected');
    });

    // Record brief audio
    const recordBtn = page.locator('button', { hasText: '●' }).or(page.locator('button', { hasText: '◉' })).first();
    await recordBtn.click();
    await page.waitForTimeout(1000);
    await recordBtn.click(); // Stop recording

    // Click send
    const sendBtn = page.locator('button:has-text("Send")');
    await expect(sendBtn).toBeVisible();
    await sendBtn.click();

    // Should transition to uploadFailed phase
    await expect(page.locator('text=UPLOAD FAILED — RETRY')).toBeVisible();

    // Remove the route abort and try again
    await page.unroute('**/media*');
    
    // Click send again (should retry)
    await sendBtn.click();

    // Should return to idle
    await expect(page.locator('text=UPLOAD FAILED — RETRY')).not.toBeVisible();
    await expect(page.locator('text=REVIEW')).not.toBeVisible();
  });
});
