import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { serverUrl } from './environment';

test('Home summarizes real work and opens task, project, and recent page destinations', async ({
  page,
  request,
}) => {
  const email = `home-${randomUUID()}@example.com`;
  const password = 'playwright-password';
  const registration = await request.post(`${serverUrl}/api/auth/register`, {
    data: { email, password },
  });
  expect(registration.status()).toBe(201);
  const { token } = (await registration.json()) as { token: string };
  const headers = { authorization: `Bearer ${token}` };
  await request.patch(`${serverUrl}/api/account/setup`, {
    headers,
    data: { display_name: 'Quang' },
  });
  const account = await request.get(`${serverUrl}/api/account`, { headers });
  const { id: userId } = (await account.json()) as { id: string };
  const created = await request.post(`${serverUrl}/api/workspaces`, {
    headers,
    data: {
      name: 'Home Workspace',
      identifier: `home-${randomUUID().slice(0, 8)}`,
    },
  });
  expect(created.status()).toBe(201);
  const workspace = (await created.json()) as {
    id: string;
    identifier: string;
  };
  const base = `${serverUrl}/api/workspaces/${workspace.id}`;
  await request.post(`${serverUrl}/api/account/setup/complete`, { headers });
  const projectResponse = await request.post(`${base}/projects`, {
    headers,
    data: { name: 'Website', identifier: 'website' },
  });
  expect(projectResponse.status()).toBe(201);
  const project = (await projectResponse.json()) as { id: string };
  const configResponse = await request.get(`${base}/task-configuration`, {
    headers,
  });
  const config = (await configResponse.json()) as {
    states: { id: string; system_role: string }[];
  };
  const today = await page.evaluate(() => {
    const date = new Date();
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  });
  for (const [title, projectId, dueDate, role] of [
    ['Ship Home', project.id, today, 'todo'],
    ['Overdue task', project.id, '2000-01-01', 'todo'],
    ['Finished task', project.id, today, 'done'],
    ['Inbox idea', null, null, 'backlog'],
  ]) {
    const result = await request.post(`${base}/tasks`, {
      headers,
      data: {
        title,
        project_id: projectId,
        due_date: dueDate,
        priority: 'high',
        state_id: config.states.find((state) => state.system_role === role)?.id,
        assignee_ids: projectId ? [userId] : [],
      },
    });
    expect(result.status()).toBe(201);
  }
  const documentResponse = await request.post(`${base}/documents`, {
    headers,
    data: { title: 'Release Notes', project_id: null, parent_id: null },
  });
  expect(documentResponse.status()).toBe(201);
  await page.goto(`/w/${workspace.identifier}`);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.locator('form button[type="submit"]').click();
  await expect(page.locator('#home-my-work-summary')).toHaveText(
    '1 due today1 overdue',
  );
  await expect(page.locator('#home-inbox-summary')).toHaveText(
    '1 unorganized task',
  );
  const upcomingSection = page.getByRole('region', {
    name: 'Upcoming',
    exact: true,
  });
  await expect(upcomingSection.getByRole('list').getByRole('link')).toHaveCount(
    2,
  );
  const projects = page.getByRole('region', { name: 'Projects', exact: true });
  await expect(projects.getByRole('link', { name: /Website/ })).toContainText(
    '2 open',
  );
  await expect(
    page.getByRole('region', { name: 'Quick links' }).getByRole('link'),
  ).toHaveCount(0);
  const home = page.getByRole('region', {
    name: 'Workspace Home',
    exact: true,
  });
  const projectList = page.getByRole('region', {
    name: 'Project list',
    exact: true,
  });
  await expect(home).toHaveClass(/ui-scroll-area-viewport/);
  await expect(projectList).toHaveClass(/ui-scroll-area-viewport/);
  expect(
    await projectList.evaluate((element) => element.clientHeight),
  ).toBeLessThan(100);
  for (let index = 0; index < 10; index++) {
    const response = await request.post(`${base}/projects`, {
      headers,
      data: { name: `Project ${index}`, identifier: `project-${index}` },
    });
    expect(response.status()).toBe(201);
  }
  await page.reload();
  await expect(projectList.getByRole('link')).toHaveCount(11);
  await projectList.scrollIntoViewIfNeeded();
  await expect
    .poll(() => projectList.evaluate((element) => element.clientHeight))
    .toBe(240);
  await projectList.hover();
  const homeScrollTop = await home.evaluate((element) => element.scrollTop);
  await page.mouse.wheel(0, 150);
  await expect
    .poll(() => projectList.evaluate((element) => element.scrollTop))
    .toBeGreaterThan(0);
  expect(await home.evaluate((element) => element.scrollTop)).toBe(
    homeScrollTop,
  );
  await projectList.getByRole('link').last().focus();
  await expect(projectList.getByRole('link').last()).toBeInViewport();
  await expect(projectList.getByRole('link').last()).toBeFocused();
  const taskLink = upcomingSection.getByRole('link', { name: /Ship Home/ });
  await taskLink.focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(
    new RegExp(`/w/${workspace.identifier}/my-work\\?task=\\d+$`),
  );
  await expect(page.getByRole('textbox', { name: 'Task title' })).toHaveValue(
    'Ship Home',
  );
  await page.goBack();
  await page.reload();
  await expect(upcomingSection.getByRole('list').getByRole('link')).toHaveCount(
    2,
  );
  await projects.getByRole('link', { name: /Website/ }).click();
  await expect(page).toHaveURL(
    new RegExp(`/w/${workspace.identifier}/p/website$`),
  );
  await page.goBack();
  await page
    .getByRole('region', { name: 'Recent pages' })
    .getByRole('link', { name: /Release Notes/ })
    .click();
  await expect(page).toHaveURL(
    new RegExp(`/w/${workspace.identifier}/library\\?page=\\d+$`),
  );
  await expect(
    page.getByRole('region', { name: 'Release Notes Library note' }),
  ).toBeVisible();
});
