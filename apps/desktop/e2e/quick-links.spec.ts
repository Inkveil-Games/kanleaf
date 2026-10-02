import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { serverUrl } from './environment';

test('manages shared quick links and navigates internal targets from Home', async ({
  page,
  request,
}, testInfo) => {
  const email = `quick-links-${randomUUID()}@example.com`;
  const password = 'playwright-password';
  const registration = await request.post(`${serverUrl}/api/auth/register`, {
    data: { email, password },
  });
  expect(registration.status()).toBe(201);
  const { token } = (await registration.json()) as { token: string };
  const headers = { authorization: `Bearer ${token}` };
  expect(
    (
      await request.patch(`${serverUrl}/api/account/setup`, {
        headers,
        data: { display_name: 'Quang' },
      })
    ).status(),
  ).toBe(200);
  const created = await request.post(`${serverUrl}/api/workspaces`, {
    headers,
    data: {
      name: 'Quick links Workspace',
      identifier: `links-${randomUUID().slice(0, 8)}`,
    },
  });
  expect(created.status()).toBe(201);
  const workspace = (await created.json()) as {
    id: string;
    identifier: string;
  };
  const base = `${serverUrl}/api/workspaces/${workspace.id}`;
  expect(
    (
      await request.post(`${serverUrl}/api/account/setup/complete`, { headers })
    ).status(),
  ).toBe(200);
  expect(
    (
      await request.post(`${base}/projects`, {
        headers,
        data: { name: 'Kanleaf', identifier: 'kan' },
      })
    ).status(),
  ).toBe(201);
  expect(
    (
      await request.post(`${base}/documents`, {
        headers,
        data: { title: 'API Design', project_id: null, parent_id: null },
      })
    ).status(),
  ).toBe(201);
  await page.goto(`/w/${workspace.identifier}/home`);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.locator('form button[type="submit"]').click();
  await expect(page).toHaveURL(new RegExp(`/w/${workspace.identifier}$`));
  await expect(
    page.getByRole('heading', { name: 'Quick links', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Add link', exact: true }).click();
  await page
    .getByRole('textbox', { name: 'Title', exact: true })
    .fill('GitHub');
  await page
    .getByRole('textbox', { name: 'URL', exact: true })
    .fill('https://github.com');
  await page
    .getByRole('button', { name: 'Add quick link', exact: true })
    .click();
  await expect(
    page.getByRole('link', {
      name: 'GitHub (opens in a new tab)',
      exact: true,
    }),
  ).toHaveAttribute('target', '_blank');
  await page
    .getByRole('button', { name: 'Manage GitHub', exact: true })
    .click();
  await page.getByRole('menuitem', { name: 'Edit link', exact: true }).click();
  await page
    .getByRole('textbox', { name: 'Title', exact: true })
    .fill('GitHub Docs');
  await page
    .getByRole('textbox', { name: 'URL', exact: true })
    .fill('https://docs.github.com/en');
  await page.getByRole('button', { name: 'Save link', exact: true }).click();
  await expect(
    page.getByRole('link', { name: 'GitHub Docs (opens in a new tab)' }),
  ).toHaveAttribute('href', 'https://docs.github.com/en');
  for (const [kind, title] of [
    ['Project', 'Kanleaf'],
    ['Page', 'API Design'],
  ]) {
    await page.getByRole('button', { name: 'Add link', exact: true }).click();
    await page
      .getByRole('combobox', { name: 'Link type', exact: true })
      .click();
    await page.getByRole('option', { name: kind, exact: true }).click();
    await page.getByRole('combobox', { name: kind, exact: true }).click();
    await page.getByRole('option', { name: title, exact: true }).click();
    await page
      .getByRole('button', { name: 'Add quick link', exact: true })
      .click();
    await expect(
      page
        .locator('.home-quick-grid')
        .getByRole('link', { name: title, exact: true }),
    ).toBeVisible();
  }
  await page
    .getByRole('button', { name: 'Manage API Design', exact: true })
    .click();
  await page.getByRole('menuitem', { name: 'Move left', exact: true }).click();
  await expect(page.locator('.home-quick-copy strong')).toHaveText([
    'GitHub Docs',
    'API Design',
    'Kanleaf',
  ]);
  await page.reload();
  await expect(page.locator('.home-quick-copy strong')).toHaveText([
    'GitHub Docs',
    'API Design',
    'Kanleaf',
  ]);
  for (const theme of ['light', 'dark']) {
    for (const width of [1440, 960, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await page.evaluate(
        (value) => document.documentElement.setAttribute('data-theme', value),
        theme,
      );
      await page.screenshot({
        path: testInfo.outputPath(`home-${theme}-${width}.png`),
        animations: 'disabled',
      });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
    }
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page
    .locator('.home-quick-grid')
    .getByRole('link', { name: 'Kanleaf', exact: true })
    .click();
  await expect(page).toHaveURL(new RegExp(`/w/${workspace.identifier}/p/kan$`));
  await page.goBack();
  await page
    .locator('.home-quick-grid')
    .getByRole('link', { name: 'API Design', exact: true })
    .click();
  await expect(page).toHaveURL(
    new RegExp(`/w/${workspace.identifier}/library\\?page=\\d+$`),
  );
  await page.goBack();
  await page
    .getByRole('button', { name: 'Manage GitHub Docs', exact: true })
    .click();
  await page
    .getByRole('menuitem', { name: 'Remove link', exact: true })
    .click();
  await page.getByRole('button', { name: 'Remove link', exact: true }).click();
  await expect(page.locator('.home-quick-copy strong')).toHaveText([
    'API Design',
    'Kanleaf',
  ]);
  await page.reload();
  await expect(page.locator('.home-quick-copy strong')).toHaveText([
    'API Design',
    'Kanleaf',
  ]);
  const links = await request.get(`${base}/quick-links`, { headers });
  expect(links.status()).toBe(200);
  expect(
    ((await links.json()) as { title: string }[]).map((link) => link.title),
  ).toEqual(['API Design', 'Kanleaf']);
});
