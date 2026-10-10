import { expect, type Page } from '@playwright/test';

export async function openRecordSurface(page: Page) {
  await page.getByRole('button', { name: 'NEW PROJECT', exact: true }).click();
  const project = page.getByRole('dialog', { name: 'New Project' });
  await project.getByRole('checkbox', { name: 'Create first post' }).check();
  await project.getByRole('button', { name: 'Next: First Post' }).click();
  await expect(page.getByRole('button', { name: 'Record', exact: true })).toBeVisible();
}
