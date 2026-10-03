import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { serverUrl } from './environment';

test('restores Graph, preserves its viewport through detail, and projects canonical dependencies', async ({
  page,
  request,
}, testInfo) => {
  const email = `graph-${randomUUID()}@example.com`;
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
        data: { display_name: 'Graph tester' },
      })
    ).status(),
  ).toBe(200);
  const response = await request.post(`${serverUrl}/api/workspaces`, {
    headers,
    data: {
      name: 'Execution team',
      identifier: `graph-${randomUUID().slice(0, 8)}`,
    },
  });
  expect(response.status()).toBe(201);
  const workspace = (await response.json()) as {
    id: string;
    identifier: string;
  };
  expect(
    (
      await request.post(`${serverUrl}/api/account/setup/complete`, { headers })
    ).status(),
  ).toBe(200);
  const base = `${serverUrl}/api/workspaces/${workspace.id}`;
  const configuration = (await (
    await request.get(`${base}/task-configuration`, { headers })
  ).json()) as { states: { id: string; system_role: string }[] };
  const done = configuration.states.find(
    (state) => state.system_role === 'done',
  );
  if (!done) throw new Error('Workspace has no Done state');
  const tasks: Record<string, { id: string; reference: string }> = {};
  for (const title of [
    'Release',
    'API Layer',
    'Backend',
    'Frontend',
    'DB Schema',
    'Research',
    'UI Design',
  ]) {
    const created = await request.post(`${base}/tasks`, {
      headers,
      data: {
        title,
        priority: 'high',
        ...(title === 'DB Schema' ||
        title === 'Research' ||
        title === 'UI Design'
          ? { state_id: done.id }
          : {}),
        ...(title === 'Backend' || title === 'Frontend'
          ? { parent_id: tasks.Release?.id }
          : {}),
      },
    });
    expect(created.status()).toBe(201);
    tasks[title] = (await created.json()) as { id: string; reference: string };
  }
  for (const [source, target] of [
    ['DB Schema', 'API Layer'],
    ['Research', 'API Layer'],
    ['API Layer', 'Backend'],
    ['API Layer', 'Frontend'],
    ['UI Design', 'Frontend'],
    ['Backend', 'Release'],
    ['Frontend', 'Release'],
  ]) {
    expect(
      (
        await request.post(`${base}/tasks/${tasks[source]?.id}/relations`, {
          headers,
          data: { task_id: tasks[target]?.id, relation_type: 'blocking' },
        })
      ).status(),
    ).toBe(201);
  }
  const viewResponse = await request.post(`${base}/views`, {
    headers,
    data: {
      name: 'Execution',
      layout: 'graph',
      query: {
        version: 2,
        scope: { kind: 'workspace' },
        include_completed: true,
      },
    },
  });
  expect(viewResponse.status()).toBe(201);
  const view = (await viewResponse.json()) as { id: string };
  await page.goto('/');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.locator('form button[type="submit"]').click();
  await page.waitForURL(/\/w\//);
  const path = `/w/${workspace.identifier}/views/${view.id}`;
  await page.goto(path);
  const graph = page.getByRole('region', {
    name: 'Execution Graph',
    exact: true,
  });
  await expect(graph).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Graph view', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(graph.locator('.react-flow__node')).toHaveCount(7);
  await expect(graph.getByText('Completed · 3')).toBeVisible();
  await expect(
    graph.getByRole('button', { name: /API Layer, Ready/ }),
  ).toBeVisible();
  await expect(
    graph.getByRole('button', { name: /Frontend, Blocked/ }),
  ).toBeVisible();
  await expect(graph.locator('.execution-edge-blocks')).toHaveCount(7);
  await expect(graph.locator('.execution-edge-parent')).toHaveCount(2);
  const viewport = graph.locator('.react-flow__viewport');
  const initialViewport = await viewport.getAttribute('style');
  await graph.getByRole('button', { name: 'Fit graph' }).click();
  await expect(viewport).not.toHaveAttribute('style', initialViewport ?? '');
  const before = await viewport.getAttribute('style');
  await graph.getByRole('button', { name: /API Layer, Ready/ }).focus();
  await page.keyboard.press('Enter');
  await expect(
    page.getByRole('region', { name: 'Task detail', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Task title' })).toHaveValue(
    'API Layer',
  );
  await page.getByRole('button', { name: 'Close task', exact: true }).click();
  await expect(page).toHaveURL(path);
  await expect(viewport).toHaveAttribute('style', before ?? '');
  await graph.getByRole('button', { name: /Release, Blocked/ }).click();
  const detail = page.getByRole('region', { name: 'Task detail', exact: true });
  await detail.locator('summary').filter({ hasText: 'Relations' }).click();
  await detail.getByRole('combobox', { name: 'Relation type' }).click();
  await page.getByRole('option', { name: 'Blocking', exact: true }).click();
  await detail.getByRole('combobox', { name: 'Related task' }).click();
  await page.getByRole('option', { name: /API Layer/ }).click();
  await detail.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(detail.getByRole('alert')).toContainText('would create a cycle');
  await expect(detail.locator('.task-relation-row')).toHaveCount(2);
  await page.getByRole('button', { name: 'Close task', exact: true }).click();

  const todo = configuration.states.find(
    (state) => state.system_role === 'todo',
  );
  if (!todo) throw new Error('Workspace has no Todo state');
  expect(
    (
      await request.patch(`${base}/tasks/${tasks['API Layer']?.id}`, {
        headers,
        data: { state_id: done.id },
      })
    ).status(),
  ).toBe(200);
  await expect(
    graph.getByRole('button', { name: /Frontend, Ready/ }),
  ).toBeVisible();
  await expect(viewport).toHaveAttribute('style', before ?? '');
  expect(
    (
      await request.patch(`${base}/tasks/${tasks['API Layer']?.id}`, {
        headers,
        data: { state_id: todo.id },
      })
    ).status(),
  ).toBe(200);
  await expect(
    graph.getByRole('button', { name: /Frontend, Blocked/ }),
  ).toBeVisible();
  const nodePositions = await graph
    .locator('.react-flow__node')
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('style')));
  await graph.getByRole('checkbox', { name: 'Parent', exact: true }).click();
  await expect(graph.locator('.execution-edge-parent')).toHaveCount(0);
  await graph.getByRole('checkbox', { name: 'Blocks', exact: true }).click();
  await expect(graph.locator('.execution-edge-blocks')).toHaveCount(0);
  expect(
    await graph
      .locator('.react-flow__node')
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('style'))),
  ).toEqual(nodePositions);
  await graph.getByRole('checkbox', { name: 'Blocks', exact: true }).click();
  await graph
    .getByRole('button', { name: 'Completed: Show', exact: true })
    .click();
  await expect(graph.locator('.react-flow__node')).toHaveCount(4);
  await graph
    .getByRole('button', { name: 'Completed: Hide', exact: true })
    .click();
  await graph.getByRole('checkbox', { name: 'Parent', exact: true }).click();
  await graph.getByRole('button', { name: 'Zoom in' }).click();
  await graph.getByRole('button', { name: 'Zoom out' }).click();
  await graph.getByRole('button', { name: 'Re-layout' }).click();
  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme });
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 844 });
      await expect(
        graph.getByRole('button', { name: 'Fit graph' }),
      ).toBeVisible();
      await page.screenshot({
        path: testInfo.outputPath(`graph-${colorScheme}-${width}.png`),
      });
    }
  }
  await page.setViewportSize({ width: 1280, height: 800 });
  await graph.getByRole('checkbox', { name: 'Parent', exact: true }).click();
  const saved = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/views/${view.id}`) &&
      response.request().method() === 'PATCH',
  );
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  expect((await saved).status()).toBe(200);
  await page.reload();
  await expect(graph).toBeVisible();
  await expect(graph.locator('.react-flow__node')).toHaveCount(7);
  await expect(
    graph.getByRole('checkbox', { name: 'Parent', exact: true }),
  ).not.toBeChecked();
  await expect(graph.locator('.execution-edge-parent')).toHaveCount(0);
  expect(
    (
      await request.delete(`${base}/tasks/${tasks['API Layer']?.id}`, {
        headers,
      })
    ).status(),
  ).toBe(204);
  await expect(graph.locator('.react-flow__node')).toHaveCount(6);
  await expect(
    graph.getByRole('button', { name: /Frontend, Ready/ }),
  ).toBeVisible();
  expect(
    (
      await request.post(`${base}/tasks/${tasks['DB Schema']?.id}/delete`, {
        headers,
        data: { reference: tasks['DB Schema']?.reference },
      })
    ).status(),
  ).toBe(204);
  await expect(graph.locator('.react-flow__node')).toHaveCount(5);
  await expect(graph.getByText('Completed · 2')).toBeVisible();
});
