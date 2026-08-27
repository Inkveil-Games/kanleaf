import { expect, test, type APIRequestContext } from '@playwright/test';
import { serverUrl } from './environment';

test('manages structured work and durable Markdown across reloads', async ({
  page,
}) => {
  const suffix = `${Date.now()}-${test.info().workerIndex}`;
  await page.goto('/');

  await expect(
    page.getByRole('heading', { name: 'Sign in to Kanleaf' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'New account' }).click();
  await page.getByLabel('Email').fill(`e2e-${suffix}@example.com`);
  await page.locator('input[type="password"]').fill('playwright-password');
  await page.getByRole('button', { name: 'Register' }).click();

  const workspaceSelect = page.getByLabel('Active workspace');
  await expect(workspaceSelect).toHaveValue(/.+/);
  await expect(workspaceSelect.locator('option')).toContainText(['Personal']);

  await page.getByLabel('Workspace actions').click();
  await page.getByRole('menuitem', { name: 'New workspace' }).click();
  await page.getByLabel('Workspace name').fill('Studio');
  await page.getByRole('button', { name: 'Create workspace' }).click();
  await expect(workspaceSelect).toHaveValue(/.+/);
  await expect(workspaceSelect.locator('option:checked')).toHaveText('Studio');

  await page.getByLabel('Workspace actions').click();
  await page.getByRole('menuitem', { name: 'Workspace settings' }).click();
  await expect(page.getByRole('heading', { name: 'General' })).toBeVisible();
  await page.getByLabel('Workspace name').fill('Studio Workspace');
  await page.getByRole('button', { name: 'Save workspace' }).click();
  await expect(page.getByText('Workspace updated')).toBeVisible();
  await expect(workspaceSelect.locator('option:checked')).toHaveText(
    'Studio Workspace',
  );
  await page.getByRole('button', { name: 'Profile' }).click();
  await page.getByLabel('Display name').fill('Kanleaf Tester');
  await page.getByRole('button', { name: 'Save profile' }).click();
  await expect(page.getByText('Profile updated')).toBeVisible();
  await expect(page.locator('.account-copy')).toContainText('Kanleaf Tester');
  await page.setViewportSize({ width: 960, height: 640 });
  await page.getByRole('button', { name: 'General' }).click();
  await page.getByRole('button', { name: 'States' }).click();
  await page.getByPlaceholder('State name').fill('Review');
  await page.getByLabel('State group').selectOption('in_progress');
  await page.getByRole('button', { name: 'Add state' }).click();
  await expect(page.getByLabel('Review name')).toBeVisible();
  await page.getByRole('button', { name: 'Task types' }).click();
  await page.getByPlaceholder('Type name').fill('Bug');
  await page.getByLabel('Task type icon key').fill('bug');
  await page.getByRole('button', { name: 'Add type' }).click();
  await expect(page.getByLabel('Bug name')).toBeVisible();
  await page.getByRole('button', { name: 'Back to Workspace' }).click();

  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByLabel('Project name').fill('Kanleaf');
  await page.getByRole('button', { name: 'Create project' }).click();
  await expect(page.getByRole('heading', { name: 'Kanleaf' })).toBeVisible();

  await page
    .locator('.project-header-actions')
    .getByRole('button', { name: 'Settings' })
    .click();
  await page.getByLabel('Description').fill('Kanleaf Core delivery project.');
  await page.getByLabel('Visibility').selectOption('open');
  await page.getByRole('button', { name: 'Save general settings' }).click();
  await expect(page.getByText('Project details saved.')).toBeVisible();
  await page.getByRole('button', { name: 'Features' }).click();
  await page
    .locator('.feature-toggle-row')
    .filter({ hasText: 'Cycles' })
    .locator('input')
    .check();
  await page.getByRole('button', { name: 'Save features' }).click();
  await expect(page.getByText('Project features saved.')).toBeVisible();
  await page.getByRole('button', { name: 'Back to Project' }).click();
  await expect(page.getByText('Kanleaf Core delivery project.')).toBeVisible();
  await page
    .locator('.project-header-actions')
    .getByRole('button', { name: 'Work items' })
    .click();

  await page.getByRole('button', { name: 'New task' }).click();
  await page.getByLabel('Task title').fill('Complete the v0.1 workflow');
  await page.getByRole('button', { name: 'Add' }).click();
  await expect(page.getByLabel('Task title')).toHaveValue(
    'Complete the v0.1 workflow',
  );

  await page.getByLabel('State').selectOption({ label: 'Review' });
  await page.getByLabel('Task type').selectOption({ label: 'Bug' });
  await page.getByLabel('Priority').selectOption('urgent');
  await page.getByLabel('Project', { exact: true }).selectOption('');

  await page.getByRole('button', { name: 'Inbox' }).click();
  const taskRow = page
    .locator('.task-row-main')
    .filter({ hasText: 'Complete the v0.1 workflow' });
  await taskRow.click();
  const markdown = `# Architecture

Kanleaf keeps **structured work** beside durable notes.

- [x] PostgreSQL metadata
- [x] Filesystem Markdown

| Layer | Storage |
| --- | --- |
| Task | PostgreSQL |
| Notes | Vault |`;
  const source = page.locator('.cm-content[contenteditable="true"]');
  await source.fill(markdown);
  await page.getByRole('button', { name: 'Preview' }).click();
  await expect(
    page.getByRole('heading', { name: 'Architecture' }),
  ).toBeVisible();
  await expect(page.getByRole('table')).toContainText('Notes');
  await page.getByRole('button', { name: 'Save Markdown' }).click();
  await expect(page.getByText('Saved', { exact: true })).toBeVisible();

  await page.reload();
  await expect(taskRow).toBeVisible();
  await taskRow.click();
  await expect(page.getByLabel('State')).toHaveValue(/.+/);
  await expect(page.getByLabel('State').locator('option:checked')).toHaveText(
    'Review',
  );
  await expect(page.getByLabel('Task type')).toHaveValue(/.+/);
  await expect(
    page.getByLabel('Task type').locator('option:checked'),
  ).toHaveText('Bug');
  await expect(page.getByLabel('Priority')).toHaveValue('urgent');
  await expect(
    page.getByRole('heading', { name: 'Architecture' }),
  ).toBeVisible();
  await expect(page.getByText('Filesystem Markdown')).toBeVisible();
});

test('prevents a session from reading another workspace', async ({
  request,
}) => {
  const suffix = `${Date.now()}-${test.info().workerIndex}`;
  const first = await register(request, `owner-${suffix}@example.com`);
  const second = await register(request, `outsider-${suffix}@example.com`);

  const create = await request.post(
    `${serverUrl}/api/workspaces/${first.workspaceId}/tasks`,
    {
      headers: { authorization: `Bearer ${first.token}` },
      data: { title: 'Private workspace task' },
    },
  );
  expect(create.status()).toBe(201);

  const forbidden = await request.get(
    `${serverUrl}/api/workspaces/${first.workspaceId}/tasks`,
    { headers: { authorization: `Bearer ${second.token}` } },
  );
  expect(forbidden.status()).toBe(403);
  expect(await forbidden.json()).toMatchObject({
    error: { code: 'forbidden' },
  });
});

async function register(request: APIRequestContext, email: string) {
  const response = await request.post(`${serverUrl}/api/auth/register`, {
    data: { email, password: 'playwright-password' },
  });
  expect(response.status()).toBe(201);
  const payload = (await response.json()) as {
    token: string;
    user: { active_workspace_id: string };
  };
  return {
    token: payload.token,
    workspaceId: payload.user.active_workspace_id,
  };
}
