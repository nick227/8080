import { expect, type Page } from '@playwright/test';

// The Lobby has no "New conversation" button any more (homepage redesign); `?record=1` opens the dialog.
export async function openRecordSurface(page: Page) {
  await page.goto('/?record=1');
  const project = page.getByRole('dialog', { name: 'New conversation' });
  await project.getByRole('checkbox', { name: 'Create first post' }).check();
  await project.getByRole('button', { name: 'Next: First Post' }).click();
  await expect(page.getByRole('button', { name: 'Record', exact: true })).toBeVisible();
}
