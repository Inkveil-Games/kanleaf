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
  await page.getByRole('button', { name: 'Back to Workspace' }).click();
  await page.locator('.account-button').click();
  await expect(
    page.getByRole('region', { name: 'Account settings' }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Members' })).not.toBeVisible();
  await page.getByLabel('Display name').fill('Kanleaf Tester');
  await page.getByRole('button', { name: 'Save profile' }).click();
  await expect(page.getByText('Profile updated')).toBeVisible();
  await expect(page.locator('.account-copy')).toContainText('Kanleaf Tester');
  await page.getByRole('button', { name: 'Back to Workspace' }).click();
  await page.getByLabel('Workspace actions').click();
  await page.getByRole('menuitem', { name: 'Workspace settings' }).click();
  await expect(
    page.getByRole('region', { name: 'Workspace settings' }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Profile' })).not.toBeVisible();
  await page.setViewportSize({ width: 960, height: 640 });
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

  const projectNavigation = page.locator('.project-subnav');
  await projectNavigation.getByRole('button', { name: 'Cycles' }).click();
  await page.getByRole('button', { name: 'New cycle' }).click();
  await page.getByLabel('Cycle name').fill('Cycle 1');
  await page.getByLabel('Start', { exact: true }).fill('2026-09-01');
  await page.getByLabel('Due', { exact: true }).fill('2026-09-14');
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Cycle 1', level: 2 }),
  ).toBeVisible();

  await projectNavigation.getByRole('button', { name: 'Modules' }).click();
  await page.getByRole('button', { name: 'New module' }).click();
  await page.getByLabel('Module name').fill('Core');
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Core', level: 2 }),
  ).toBeVisible();

  await page
    .locator('.project-subnav')
    .getByRole('button', { name: 'Work items' })
    .click();

  await page.getByRole('button', { name: 'New task' }).click();
  await page.getByLabel('Task title').fill('Complete the v0.1 workflow');
  await page.getByRole('button', { name: 'Add' }).click();
  await expect(page.getByLabel('Task title')).toHaveValue(
    'Complete the v0.1 workflow',
  );

  await page.getByLabel('Cycle').selectOption({ label: 'Cycle 1' });
  await expect(page.getByLabel('Cycle')).toHaveValue(/.+/);
  await page.getByLabel('Edit Modules').click();
  await page.getByRole('menuitemcheckbox', { name: 'Core' }).click();
  await expect(page.getByLabel('Edit Modules')).toContainText('Core');
  await page.keyboard.press('Escape');

  await page.getByLabel('State').selectOption({ label: 'Review' });
  await page.getByLabel('Task type').selectOption({ label: 'Bug' });
  await page.getByLabel('Priority').selectOption('urgent');
  await page.getByLabel('Edit assignees').click();
  await page.getByRole('menuitemcheckbox', { name: 'Kanleaf Tester' }).click();
  await page.getByLabel('Due date').fill('2026-09-30');
  page.once('dialog', (dialog) => void dialog.accept());
  await page.getByLabel('Project', { exact: true }).selectOption('');

  await page.getByRole('button', { name: 'My Work' }).click();
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

  await page.getByRole('button', { name: 'Filter tasks' }).click();
  await page.getByRole('menuitemcheckbox', { name: 'Urgent' }).click();
  await page.keyboard.press('Escape');
  await page.getByLabel('Layout').selectOption('table');
  await page.getByRole('button', { name: 'Save View' }).click();
  await page.getByLabel('Name').fill('Urgent work');
  await page.getByRole('radio', { name: /Shared/ }).click();
  await page.getByRole('button', { name: 'Create View' }).click();
  await expect(
    page.getByRole('heading', { name: 'Urgent work' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'My Work' }).click();

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
  await expect(page.getByLabel('Due date')).toHaveValue('2026-09-30');
  await expect(
    page.getByRole('heading', { name: 'Architecture' }),
  ).toBeVisible();
  await expect(page.getByText('Filesystem Markdown')).toBeVisible();

  await page.getByRole('button', { name: 'Urgent work' }).click();
  await expect(page.getByLabel('Layout')).toHaveValue('table');
  await expect(page.getByRole('table')).toContainText(
    'Complete the v0.1 workflow',
  );
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
  const task = (await create.json()) as { id: string };

  const forbidden = await request.get(
    `${serverUrl}/api/workspaces/${first.workspaceId}/tasks`,
    { headers: { authorization: `Bearer ${second.token}` } },
  );
  expect(forbidden.status()).toBe(403);
  expect(await forbidden.json()).toMatchObject({
    error: { code: 'forbidden' },
  });

  const activityForbidden = await request.get(
    `${serverUrl}/api/workspaces/${first.workspaceId}/tasks/${task.id}/activity`,
    { headers: { authorization: `Bearer ${second.token}` } },
  );
  expect(activityForbidden.status()).toBe(403);
});

test('delivers collaboration activity through the notification inbox', async ({
  page,
  request,
}) => {
  const suffix = `${Date.now()}-${test.info().workerIndex}`;
  const owner = await register(request, `collab-owner-${suffix}@example.com`);
  const memberEmail = `collab-member-${suffix}@example.com`;
  const member = await register(request, memberEmail);
  const ownerHeaders = { authorization: `Bearer ${owner.token}` };
  const memberHeaders = { authorization: `Bearer ${member.token}` };

  const invitationResponse = await request.post(
    `${serverUrl}/api/workspaces/${owner.workspaceId}/invitations`,
    {
      headers: ownerHeaders,
      data: { email: memberEmail, role: 'member' },
    },
  );
  expect(invitationResponse.status()).toBe(201);
  const invitation = (await invitationResponse.json()) as { id: string };
  const accepted = await request.post(
    `${serverUrl}/api/invitations/${invitation.id}/accept`,
    { headers: memberHeaders },
  );
  expect(accepted.status()).toBe(204);

  const taskResponse = await request.post(
    `${serverUrl}/api/workspaces/${owner.workspaceId}/tasks`,
    {
      headers: ownerHeaders,
      data: { title: 'Collaborate securely' },
    },
  );
  expect(taskResponse.status()).toBe(201);
  const task = (await taskResponse.json()) as { id: string };
  const commentResponse = await request.post(
    `${serverUrl}/api/workspaces/${owner.workspaceId}/tasks/${task.id}/comments`,
    {
      headers: memberHeaders,
      data: {
        body: 'Please review the **authorization boundary**.',
        parent_id: null,
        mention_ids: [],
      },
    },
  );
  expect(commentResponse.status()).toBe(201);

  await page.addInitScript(
    (token) => localStorage.setItem('kanleaf.session-token', token),
    owner.token,
  );
  await page.goto('/');
  await expect(page.getByLabel('Active workspace')).toHaveValue(
    owner.workspaceId,
  );
  await expect(page.getByLabel('1 unread')).toBeVisible();
  await page.getByRole('button', { name: 'Notifications' }).click();
  await page
    .getByRole('button', { name: /commented on.*Collaborate securely/ })
    .click();

  await expect(page.getByLabel('Task title')).toHaveValue(
    'Collaborate securely',
  );
  await page.getByRole('tab', { name: 'Activity' }).click();
  await expect(
    page.locator('.activity-comment .markdown-preview strong'),
  ).toHaveText('authorization boundary');
  await expect(page.getByLabel('1 unread')).not.toBeVisible();

  await page
    .locator('.activity-comment')
    .filter({ hasText: 'authorization boundary' })
    .getByRole('button', { name: 'Reply' })
    .click();
  await page
    .getByLabel('Add comment')
    .fill('Confirmed. The boundary is enforced.');
  const replySaved = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      response.url().endsWith(`/tasks/${task.id}/comments`),
  );
  await page.getByRole('button', { name: 'Comment', exact: true }).click();
  expect((await replySaved).status()).toBe(201);
  await expect(
    page.locator('.activity-comment-reply .markdown-preview'),
  ).toContainText('Confirmed. The boundary is enforced.');

  const memberNotifications = await request.get(
    `${serverUrl}/api/notifications`,
    {
      headers: memberHeaders,
    },
  );
  expect(memberNotifications.status()).toBe(200);
  expect(await memberNotifications.json()).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        notification_type: 'reply',
        task_id: task.id,
      }),
    ]),
  );
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
