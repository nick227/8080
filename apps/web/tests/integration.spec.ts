import { test, expect } from '@playwright/test';
import { openRecordSurface } from './helpers/project';

test.describe('Main Integration Path', () => {
  // Use two distinct browser contexts to represent Alice and Bob
  test('record, upload, SSE notification, and remote playback', async ({ browser }) => {
    // We do NOT mock the API here. We expect the full stack (web + server) to be running.
    
    // Create Alice's context (the creator)
    const aliceContext = await browser.newContext();
    // Grant permissions so we don't get stuck on the prompt
    await aliceContext.grantPermissions(['camera', 'microphone']);
    const alice = await aliceContext.newPage();
    
    // Create Bob's context (the consumer)
    const bobContext = await browser.newContext();
    const bob = await bobContext.newPage();
    bob.on('console', msg => console.log('BOB CONSOLE:', msg.text()));
    bob.on('pageerror', err => console.log('BOB ERROR:', err.message));

    // 1. Alice goes to home
    await alice.goto('/');

    // 2. Create a project with its first post.
    await openRecordSurface(alice);

    // 3. Alice records a message
    const recordBtn = alice.getByRole('button', { name: 'Record' });
    await expect(recordBtn).toBeVisible();
    await recordBtn.click();
    
    const stopBtn = alice.getByRole('button', { name: 'Stop' });
    await expect(stopBtn).toBeVisible();
    await alice.waitForTimeout(1000); // Record 1s of media
    await stopBtn.click();

    // 4. Review stage
    const playBtn = alice.getByRole('button', { name: 'Play', exact: true }).first();
    await expect(playBtn).toBeVisible({ timeout: 10000 });

    // Name, description and picture are all optional: save with every field blank.
    // 5. Save and upload (this tests the upload to volume and create item API)
    const saveBtn = alice.getByRole('button', { name: /Save|Send/ });
    await expect(saveBtn).toBeVisible();
    await saveBtn.click();

    // Wait for the upload and item creation to finish.
    // The feed should render the media item.
    const aliceMediaItem = alice.locator('audio, video').first();
    await expect(aliceMediaItem).toBeAttached({ timeout: 15000 });

    // 6. Extract the room URL to have Bob join
    await alice.waitForURL(/\/room\//, { timeout: 15000 });
    const roomUrl = alice.url();
    console.log('ALICE ROOM URL:', roomUrl);

    // 7. Bob joins the room
    await bob.goto(roomUrl);
    
    // Bob should see the media item Alice created (loaded from the DB)
    const bobMediaItem = bob.locator('audio, video').first();
    await bob.screenshot({ path: 'test-results/bob-room.png' });
    await expect(bobMediaItem).toBeAttached({ timeout: 10000 });

    // Videos now play inline in the chat stream.
    await bobMediaItem.click();
    await expect(async () => {
      const currentTime = await bobMediaItem.evaluate((m: HTMLMediaElement) => m.currentTime);
      expect(currentTime).toBeGreaterThan(0.1);
    }).toPass({ timeout: 5000 });

    // 8. Test SSE notification by having Alice post AGAIN while Bob is already in the room
    
    // Open the recorder from chat, then use the dialog's controls.
    await alice.getByRole('button', { name: 'Record', exact: true }).click();
    const recorder = alice.getByRole('dialog', { name: 'Record', exact: true });
    await recorder.getByRole('button', { name: 'Record', exact: true }).click();
    await expect(recorder.getByRole('button', { name: 'Stop' })).toBeVisible();
    await alice.waitForTimeout(1000);
    await recorder.getByRole('button', { name: 'Stop' }).click();

    await expect(recorder.getByRole('button', { name: /Save|Send/ })).toBeVisible({ timeout: 10000 });
    await recorder.getByRole('button', { name: /Save|Send/ }).click();

    // Wait for Alice to see both items
    await expect(alice.locator('audio, video')).toHaveCount(2, { timeout: 15000 });

    // 9. Wait for Bob to receive the new item via SSE (a second media element automatically appears)
    // This validates the SSE notification -> second client receives update path without Bob refreshing!
    await expect(bob.locator('audio, video')).toHaveCount(2, { timeout: 15000 });
  });
});
