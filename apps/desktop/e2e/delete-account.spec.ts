import { expect, test } from '@playwright/test';
import { serverUrl } from './environment';

test('blocks owners, then deletes the account after separate Workspace deletion', async ({
  page,
  request,
}) => {
  const identifier = `delete-account-${Date.now()}`;
  const email = `${identifier}@example.com`;
  const password = 'playwright-password';
  await page.goto('/');
  await page.getByRole('button', { name: 'New account' }).click();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByLabel('Confirm password').fill(password);
  await page.getByRole('button', { name: 'Register' }).click();
  await page.getByRole('button', { name: 'Use default preferences' }).click();
  await page.getByLabel('Workspace name').fill('Account deletion team');
  await page.getByLabel('Workspace ID').fill(identifier);
  await page.getByRole('button', { name: 'Create Workspace' }).click();
  await page.getByRole('button', { name: 'Skip for now' }).click();
  await expect(page).toHaveURL(new RegExp(`/w/${identifier}$`));
  const login = await request.post(`${serverUrl}/api/auth/login`, {
    data: { email, password },
  });
  expect(login.ok()).toBe(true);
  const { token } = (await login.json()) as { token: string };

  await page.goto(`/w/${identifier}/settings/account/profile`);
  await page.getByRole('button', { name: 'Danger zone', exact: true }).click();
  await expect(page).toHaveURL(new RegExp('/settings/account/danger$'));
  await page
    .getByRole('button', { name: 'Delete account', exact: true })
    .click();
  const dialog = page.getByRole('alertdialog', { name: 'Delete account?' });
  const confirm = dialog.getByRole('button', {
    name: 'Delete account',
    exact: true,
  });
  await expect(confirm).toBeDisabled();
  await dialog.getByLabel('Current password').fill(password);
  await dialog
    .getByRole('textbox', { name: /^Type / })
    .fill('wrong@example.com');
  await expect(confirm).toBeDisabled();
  await dialog.getByRole('textbox', { name: /^Type / }).fill(email);
  await expect(confirm).toBeEnabled();
  await confirm.click();
  await expect(dialog.getByRole('alert')).toContainText(
    'Account deletion team',
  );
  await expect(dialog).toBeVisible();
  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme });
    for (const viewport of [
      { width: 1280, height: 800 },
      { width: 390, height: 844 },
    ]) {
      await page.setViewportSize(viewport);
      await expect(confirm).toBeVisible();
      const bounds = await dialog.boundingBox();
      if (!bounds) throw new Error('Confirmation dialog is not visible');
      expect(bounds.x).toBeGreaterThanOrEqual(0);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width);
      await page.screenshot({
        path: test
          .info()
          .outputPath(`delete-account-${colorScheme}-${viewport.width}.png`),
      });
    }
  }
  await page.setViewportSize({ width: 1280, height: 800 });
  await dialog.getByRole('button', { name: 'Cancel' }).click();

  await page.goto(`/w/${identifier}/settings/workspace/danger`);
  await page
    .getByRole('button', { name: 'Delete Workspace', exact: true })
    .click();
  const workspaceDialog = page.getByRole('alertdialog', {
    name: 'Delete Account deletion team permanently?',
  });
  await workspaceDialog
    .getByRole('textbox', { name: /^Type / })
    .fill('Account deletion team');
  await workspaceDialog.getByLabel('Current password').fill(password);
  await workspaceDialog
    .getByRole('button', { name: 'Delete Workspace', exact: true })
    .click();
  await expect(workspaceDialog).not.toBeVisible();
  await page
    .getByRole('link', { name: 'Account settings', exact: true })
    .click();
  await page.getByRole('button', { name: 'Danger zone', exact: true }).click();
  await page
    .getByRole('button', { name: 'Delete account', exact: true })
    .click();
  await dialog.getByRole('textbox', { name: /^Type / }).fill(email);
  await dialog.getByLabel('Current password').fill(password);
  await confirm.click();
  await expect(
    page.getByRole('heading', { name: 'Sign in to Kanleaf' }),
  ).toBeVisible();
  await expect(page).toHaveURL('/');
  expect(
    await page.evaluate(() =>
      localStorage.getItem('kanleaf.account-sessions.v1'),
    ),
  ).toBeNull();
  expect(
    (
      await request.get(`${serverUrl}/api/session`, {
        headers: { Authorization: `Bearer ${token}` },
      })
    ).status(),
  ).toBe(401);
  expect(
    (
      await request.post(`${serverUrl}/api/auth/login`, {
        data: { email, password },
      })
    ).status(),
  ).toBe(401);
});
