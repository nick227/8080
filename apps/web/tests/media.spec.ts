import { test, expect } from '@playwright/test';

import { openRecordSurface } from './helpers/project';

test.describe('Media Capture State Machine', () => {
  test.beforeEach(async ({ page }) => {
    // Mock the session API call since the backend is not running during this client-side test
    await page.route('**/auth/guest', route => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: {
            id: 'test-user',
            displayName: 'Test User',
            isGuest: true
          }
        })
      });
    });

    // Mock rooms and feeds to prevent errors
    await page.route('**/rooms/me*', route => route.fulfill({ status: 200, body: JSON.stringify({ data: [], meta: { nextCursor: null } }) }));
    await page.route('**/rooms*', route => route.fulfill({ status: 200, body: JSON.stringify({ data: [], meta: { nextCursor: null } }) }));
    await page.route('**/feed*', route => route.fulfill({ status: 200, body: JSON.stringify({ data: [], meta: { nextCursor: null } }) }));

    // Navigate to the home page
    await page.goto('/');
  });

  test('should record media and successfully play back the generated blob', async ({ page }) => {
    await openRecordSurface(page);
    
    // Start recording
    const recordButton = page.getByRole('button', { name: 'Record', exact: true });
    await recordButton.click();
    
    // Wait for state to change to Stop button and ensure we are in a dense/recording state
    const stopButton = page.getByRole('button', { name: 'Stop' });
    await expect(stopButton).toBeVisible();
    await expect(stopButton).toHaveAttribute('data-mass', 'dense');
    
    // Allow some time for media to actually be captured into a Blob
    await page.waitForTimeout(1000);

    // Stop recording
    await stopButton.click();

    // Verify play button appears
    const playButton = page.getByRole('button', { name: 'Play', exact: true }).first();
    await expect(playButton).toBeVisible({ timeout: 10000 });

    // Verify media plays and currentTime advances
    const mediaElement = page.locator('audio, video').first();
    await expect(mediaElement).toBeAttached();
    
    // Click play
    await playButton.click();
    
    // Wait for currentTime to advance using an assertion block
    await expect(async () => {
      const currentTime = await mediaElement.evaluate((m: HTMLMediaElement) => m.currentTime);
      expect(currentTime).toBeGreaterThan(0.1);
    }).toPass({ timeout: 5000 });
  });

  test('should handle permission denied gracefully', async ({ page }) => {
    // Intercept getUserMedia to throw a permission error
    await page.evaluate(() => {
      navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('Permission denied', 'NotAllowedError'));
    });

    await openRecordSurface(page);
    const recordButton = page.getByRole('button', { name: 'Record', exact: true });
    await recordButton.click();

    // Should show error and not get stuck in arming state
    const errorAlert = page.getByRole('alert');
    await expect(errorAlert).toBeVisible();
    await expect(errorAlert).toContainText(/blocked/i);
    
    // Record button should still be available
    await expect(recordButton).toBeVisible();
  });

  test('canceling an active recording session discards the capture and resets the UI', async ({ page }) => {
    await openRecordSurface(page);
    await page.getByRole('button', { name: 'Record', exact: true }).click();
    
    const stopButton = page.getByRole('button', { name: 'Stop' });
    await expect(stopButton).toBeVisible();
    
    // Cancel is hidden while recording; Escape aborts the take
    await expect(page.getByRole('button', { name: 'Cancel' })).toBeHidden();
    await page.keyboard.press('Escape');

    // Play button should NOT exist after cancelling
    await expect(page.getByRole('button', { name: 'Play', exact: true }).first()).not.toBeVisible();
  });

  test('second capture cleanly replaces the first via RETRY', async ({ page }) => {
    await openRecordSurface(page);
    
    // First record
    await page.getByRole('button', { name: 'Record', exact: true }).click();
    const stopButton = page.getByRole('button', { name: 'Stop' });
    await expect(stopButton).toBeVisible();
    await page.waitForTimeout(1000);
    await stopButton.click();
    
    // Wait for review stage
    const playButton = page.getByRole('button', { name: 'Play', exact: true }).first();
    await expect(playButton).toBeVisible({ timeout: 10000 });

    // Click RETRY to discard and record again
    const retryButton = page.getByRole('button', { name: 'RETRY' });
    await expect(retryButton).toBeVisible();
    await retryButton.click();

    // RETRY immediately begins a new capture, so we expect the Stop button
    const newStopButton = page.getByRole('button', { name: 'Stop' });
    await expect(newStopButton).toBeVisible();
    await page.waitForTimeout(1000);
    await newStopButton.click();

    // Wait for review stage again
    await expect(playButton).toBeVisible({ timeout: 10000 });
  });

  test('upload failure keeps media intact for retry', async ({ page }) => {
    // Mock the create room to fail
    await page.route('**/rooms', route => {
      if (route.request().method() === 'POST') {
        return route.fulfill({ status: 500, body: JSON.stringify({ error: 'Internal Server Error' }) });
      }
      route.fallback();
    });

    await openRecordSurface(page);
    
    await page.getByRole('button', { name: 'Record', exact: true }).click();
    const stopButton = page.getByRole('button', { name: 'Stop' });
    await expect(stopButton).toBeVisible();
    await page.waitForTimeout(1000);
    await stopButton.click();
    
    // Wait for review
    const playButton = page.getByRole('button', { name: 'Play', exact: true }).first();
    await expect(playButton).toBeVisible({ timeout: 10000 });

    // Click Save/Send
    const saveButton = page.getByRole('button', { name: /Save|Send/ });
    await expect(saveButton).toBeVisible();
    await saveButton.click();

    // Should show error
    const errorAlert = page.getByRole('alert');
    await expect(errorAlert).toBeVisible();

    // Should still be able to play (media not lost) and save button active
    await expect(playButton).toBeVisible();
    await expect(saveButton).not.toBeDisabled();
  });

});

