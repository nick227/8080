import { test, expect } from '@playwright/test';

test.describe('Exhaustive Capture & Upload Validation', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/room/demo');
    const joinButton = page.locator('text=Join as Guest');
    if (await joinButton.isVisible()) {
      await joinButton.click();
    }
    const record = page.getByRole('button', { name: 'Record', exact: true });
    if (await record.isVisible()) await record.click();
  });

  test('audio records sane levels/duration, uploads, round-trips correctly, and cleans up Blob', async ({ page, context }) => {
    // Start tracking network requests to verify no duplicate uploads and metadata
    let uploadCount = 0;
    let messageCount = 0;
    
    await page.route('**/media*', async route => {
      uploadCount++;
      await route.continue();
    });

    await page.route('**/messages*', async route => {
      if (route.request().method() === 'POST') messageCount++;
      await route.continue();
    });

    // 1. Record Audio
    const recordBtn = page.locator('button', { hasText: '●' }).or(page.locator('button', { hasText: '◉' })).first();
    await expect(recordBtn).toBeVisible();
    await recordBtn.click();
    
    // Wait for at least 1.5s of audio
    await page.waitForTimeout(1500);
    await recordBtn.click(); // Stop recording

    // 2. Local preview is available
    const waveform = page.locator('.audio-waveform');
    await expect(waveform).toBeVisible();
    
    // Verify audio duration via evaluating state
    const duration = await page.evaluate(() => {
      const audioEl = document.querySelector('audio.media-view') as HTMLAudioElement;
      return audioEl?.duration;
    });
    expect(duration).toBeGreaterThan(1);
    expect(duration).toBeLessThan(5);

    // Get the blob URL before send
    const blobUrlBefore = await page.evaluate(() => {
      return (document.querySelector('audio.media-view') as HTMLAudioElement)?.src;
    });
    expect(blobUrlBefore).toMatch(/^blob:/);

    // 3. Send and ensure double-send is impossible
    const sendBtn = page.locator('button:has-text("Send")');
    await sendBtn.click();
    
    // Attempt concurrent double-send
    await expect(sendBtn).toBeDisabled();

    // 4. Verify round trip
    // Wait for it to appear in the feed
    await expect(page.locator('text=RECORDING')).not.toBeVisible();
    await expect(page.locator('text=REVIEW')).not.toBeVisible();
    
    // Check if the feed has the uploaded audio
    const lastItemAudio = page.locator('.item').last().locator('audio');
    await expect(lastItemAudio).toBeVisible({ timeout: 10000 });
    
    // Verify it's a real HTTP url now, not a blob
    const srcAfter = await lastItemAudio.getAttribute('src');
    expect(srcAfter).not.toMatch(/^blob:/);
    
    // Check network request counts
    expect(uploadCount).toBe(1);
    expect(messageCount).toBe(1);

    // 5. Verify cleanup: the local blob URL should be revoked. 
    // We can test this by trying to fetch the blob URL.
    const fetchResult = await page.evaluate(async (url) => {
      try {
        const res = await fetch(url);
        return res.status;
      } catch (e) {
        return 'failed';
      }
    }, blobUrlBefore);
    // Revoked blob urls either throw a network error or return 404
    expect(fetchResult).toBe('failed');
  });

  test('camera blocked produces intended error', async ({ browser }) => {
    // Create a new context with denied permissions
    const ctx = await browser.newContext();
    await ctx.grantPermissions([], { origin: 'http://localhost:5173' });
    const page = await ctx.newPage();
    await page.goto('/room/demo');
    const joinButton = page.locator('text=Join as Guest');
    if (await joinButton.isVisible()) await joinButton.click();

    // Try to arm video. Mock the media devices to throw NotAllowedError immediately.
    await page.evaluate(() => {
      Object.defineProperty(navigator, 'mediaDevices', {
        value: {
          getUserMedia: () => Promise.reject(new DOMException('Permission denied', 'NotAllowedError'))
        },
        configurable: true
      });
    });

    const videoBtn = page.locator('button', { hasText: '◉' });
    await expect(videoBtn).toBeVisible();
    await videoBtn.click();
    
    // Wait to see if error banner appears
    await expect(page.locator('.status.error')).toBeVisible();
    const errorText = await page.locator('.status.error').textContent();
    expect(errorText).toContain('denied');
    
    await ctx.close();
  });

  test('upload failure retains blob and prevents duplicate on retry', async ({ page }) => {
    let uploadAttempts = 0;
    
    // Intercept uploads and force failure ONCE
    await page.route('**/media*', async route => {
      uploadAttempts++;
      if (uploadAttempts === 1) {
        await route.abort('internetdisconnected');
      } else {
        await route.continue();
      }
    });

    const recordBtn = page.locator('button', { hasText: '●' }).or(page.locator('button', { hasText: '◉' })).first();
    await recordBtn.click();
    await page.waitForTimeout(1000);
    await recordBtn.click(); // Stop recording

    const blobUrlBefore = await page.evaluate(() => {
      return (document.querySelector('audio.media-view') as HTMLAudioElement)?.src;
    });

    const sendBtn = page.locator('button:has-text("Send")');
    await sendBtn.click();

    // Should transition to uploadFailed phase
    await expect(page.locator('text=UPLOAD FAILED — RETRY')).toBeVisible();

    // Verify blob is still intact
    const blobUrlAfterFail = await page.evaluate(() => {
      return (document.querySelector('audio.media-view') as HTMLAudioElement)?.src;
    });
    expect(blobUrlAfterFail).toBe(blobUrlBefore); // Blob retained

    // Retry sending (route will succeed this time)
    await sendBtn.click();

    // Should return to idle
    await expect(page.locator('text=UPLOAD FAILED — RETRY')).not.toBeVisible();
    
    // Ensure it was only uploaded twice (1 fail, 1 success)
    expect(uploadAttempts).toBe(2);
  });

  test('arming timeout restores idle state and shows error', async ({ page }) => {
    // Try to arm video. Mock getUserMedia to hang indefinitely
    await page.evaluate(() => {
      Object.defineProperty(navigator, 'mediaDevices', {
        value: {
          getUserMedia: () => new Promise(() => {}) // never resolves
        },
        configurable: true
      });
    });

    const videoBtn = page.locator('button', { hasText: '◉' });
    await expect(videoBtn).toBeVisible();
    await videoBtn.click();
    
    // Wait to see if error banner appears with a slightly extended timeout for the 15s wait
    await expect(page.locator('.status.error')).toBeVisible({ timeout: 20000 });
    const errorText = await page.locator('.status.error').textContent();
    expect(errorText).toContain('CAMERA PERMISSION TIMED OUT');
    
    // Verify we returned to idle state (video button should be visible again and not arming)
    await expect(videoBtn).toBeVisible();
  });
});
