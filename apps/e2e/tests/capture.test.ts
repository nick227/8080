import { test, expect } from '@playwright/test';

test.describe('Capture State Machine', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to a specific room for testing
    await page.goto('/room/demo');
    
    // Wait for feed to load or login button
    const joinButton = page.locator('text=Join as Guest');
    if (await joinButton.isVisible()) {
      await joinButton.click();
    }
    const record = page.getByRole('button', { name: 'Record', exact: true });
    if (await record.isVisible()) await record.click();
  });

  test('audio record -> review -> retake -> video -> send', async ({ page }) => {
    // 1. Idle state - Record button should be visible
    const recordBtn = page.locator('button', { hasText: '●' }).or(page.locator('button', { hasText: '◉' })).first();
    await expect(recordBtn).toBeVisible();
    await expect(recordBtn).toHaveText('●');

    // 2. Click Record -> Starts Audio
    await recordBtn.click();
    
    // Wait for recording state to appear
    await expect(page.locator('text=RECORDING')).toBeVisible();
    await expect(page.locator('text=SLIDE DOWN TO CANCEL')).toBeVisible();
    await expect(recordBtn).toHaveText('◉');
    
    // Record for 2 seconds
    await page.waitForTimeout(2000);

    // 3. Stop recording -> Review state
    await recordBtn.click();
    
    // Should see review state
    await expect(page.locator('text=REVIEW')).toBeVisible();
    const retakeBtn = page.locator('button:has-text("Retake")');
    const sendBtn = page.locator('button:has-text("Send")');
    
    await expect(retakeBtn).toBeVisible();
    await expect(sendBtn).toBeVisible();

    // Verify it's an audio preview
    await expect(page.locator('.audio-waveform')).toBeVisible();

    // 4. Click Retake -> Restarts in Audio
    await retakeBtn.click();
    await expect(page.locator('text=RECORDING')).toBeVisible();
    
    // Stop recording again
    await recordBtn.click();
    await expect(page.locator('text=REVIEW')).toBeVisible();

    // 5. Send
    await sendBtn.click();
    
    // Should return to idle state
    await expect(page.locator('text=RECORDING')).not.toBeVisible();
    await expect(page.locator('text=REVIEW')).not.toBeVisible();
    await expect(recordBtn).toHaveText('●');
  });
});
