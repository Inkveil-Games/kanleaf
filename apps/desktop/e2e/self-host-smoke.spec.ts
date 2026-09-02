import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from '@playwright/test';
import { hostE2eEmail, serverUrl } from './environment';

const password = 'playwright-password';

interface AuthPayload {
  token: string;
  user: {
    id: string;
    email: string;
    display_name: string;
    active_workspace_id: string | null;
    setup_stage: 'account' | 'workspace' | 'invite' | 'complete';
    is_host: boolean;
  };
}

interface WorkspacePayload {
  id: string;
  identifier: string;
  name: string;
}

interface ReadyAuthPayload extends AuthPayload {
  user: AuthPayload['user'] & {
    active_workspace_id: string;
    setup_stage: 'complete';
  };
  workspace: WorkspacePayload;
}

interface AccessPolicy {
  restricted: boolean;
  allowed_emails: string[];
}

test('serves the browser client and protected Host route from one origin', async ({
  page,
  request,
}) => {
  await page.goto('/host');

  await expect(
    page.getByRole('heading', { name: 'Sign in to Kanleaf' }),
  ).toBeVisible();

  const hostAccess = await request.get('/api/host/access');
  expect(hostAccess.status()).toBe(401);
  await expect(hostAccess.json()).resolves.toMatchObject({
    error: { code: 'unauthorized' },
  });

  const health = await request.get('/api/health');
  expect(health.ok()).toBe(true);
  await expect(health.json()).resolves.toMatchObject({
    status: 'ok',
    service: 'kanleaf',
  });

  const unknownApi = await request.get('/api/does-not-exist');
  expect(unknownApi.status()).toBe(404);
  expect(unknownApi.headers()['content-type']).toContain('application/json');
  await expect(unknownApi.json()).resolves.toMatchObject({
    error: { code: 'not_found' },
  });

  const missingAsset = await request.get('/assets/does-not-exist.js');
  expect(missingAsset.status()).toBe(404);
});

test('restores the Host Access route through refresh and browser history', async ({
  page,
  request,
}) => {
  const host = await registerOrLogin(request, hostE2eEmail);
  expect(host.user.is_host).toBe(true);
  await page.addInitScript(
    (token) => localStorage.setItem('kanleaf.session-token', token),
    host.token,
  );

  await page.goto('/host/access');
  await expect(page).toHaveURL(`${serverUrl}/host/access`);
  await expect(page.getByRole('heading', { name: 'Access' })).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Access', exact: true }),
  ).toHaveAttribute('aria-current', 'page');

  await page.reload();
  await expect(page).toHaveURL(`${serverUrl}/host/access`);
  await expect(page.getByRole('heading', { name: 'Access' })).toBeVisible();

  await page.getByRole('button', { name: 'Workspaces' }).click();
  await expect(page).toHaveURL(`${serverUrl}/host`);
  await expect(page.getByRole('heading', { name: 'Workspaces' })).toBeVisible();

  await page.goBack();
  await expect(page).toHaveURL(`${serverUrl}/host/access`);
  await expect(page.getByRole('heading', { name: 'Access' })).toBeVisible();

  await page.goForward();
  await expect(page).toHaveURL(`${serverUrl}/host`);
  await expect(page.getByRole('heading', { name: 'Workspaces' })).toBeVisible();
});

test('restores a Workspace route through refresh and browser history', async ({
  page,
  request,
}) => {
  const host = await registerOrLogin(request, hostE2eEmail);
  expect(host.user.is_host).toBe(true);
  const inboxPath = `/w/${host.workspace.identifier}/inbox`;
  const myWorkPath = `/w/${host.workspace.identifier}/my-work`;
  const taskResponse = await request.post(
    `/api/workspaces/${host.workspace.id}/tasks`,
    {
      headers: { authorization: `Bearer ${host.token}` },
      data: { title: 'Legacy route task' },
    },
  );
  expect(taskResponse.status()).toBe(201);
  const task = (await taskResponse.json()) as {
    id: string;
    task_number: number;
  };
  await page.addInitScript(
    (token) => localStorage.setItem('kanleaf.session-token', token),
    host.token,
  );

  await page.goto(inboxPath);
  await expect(page).toHaveURL(`${serverUrl}${inboxPath}`);
  await expect(page.getByRole('heading', { name: 'Inbox' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Inbox' })).toHaveAttribute(
    'aria-current',
    'page',
  );

  await page.reload();
  await expect(page).toHaveURL(`${serverUrl}${inboxPath}`);
  await expect(page.getByRole('heading', { name: 'Inbox' })).toBeVisible();

  await page.getByRole('button', { name: 'My Work' }).click();
  await expect(page).toHaveURL(`${serverUrl}${myWorkPath}`);
  await expect(page.getByRole('heading', { name: 'My Work' })).toBeVisible();

  await page.goBack();
  await expect(page).toHaveURL(`${serverUrl}${inboxPath}`);
  await expect(page.getByRole('heading', { name: 'Inbox' })).toBeVisible();

  await page.goForward();
  await expect(page).toHaveURL(`${serverUrl}${myWorkPath}`);
  await expect(page.getByRole('heading', { name: 'My Work' })).toBeVisible();

  await page.goto(`/${host.workspace.identifier}/inbox`);
  await expect(page).toHaveURL(`${serverUrl}${inboxPath}`);

  const legacyPath = `/w/${host.workspace.id}/inbox?task=${task.id}#reload`;
  const canonicalLegacyPath = `${inboxPath}?task=${task.task_number}#reload`;
  await page.goto(legacyPath);
  await expect(page).toHaveURL(`${serverUrl}${canonicalLegacyPath}`);
  await expect(page.getByRole('heading', { name: 'Inbox' })).toBeVisible();
  await page.reload();
  await expect(page).toHaveURL(`${serverUrl}${canonicalLegacyPath}`);
  await expect(page.getByRole('heading', { name: 'Inbox' })).toBeVisible();
});

test('manages Restricted access through the Host Console', async ({
  page,
  request,
}) => {
  const suffix = `${Date.now()}-${test.info().workerIndex}`;
  const existingEmail = `existing-${suffix}@example.com`;
  const approvedEmail = `approved-${suffix}@example.com`;
  const unlistedEmail = `unlisted-${suffix}@example.com`;
  const host = await registerOrLogin(request, hostE2eEmail);
  expect(host.user.is_host).toBe(true);
  const hostHeaders = { authorization: `Bearer ${host.token}` };

  const originalResponse = await request.get('/api/host/access', {
    headers: hostHeaders,
  });
  expect(originalResponse.status()).toBe(200);
  const originalPolicy = (await originalResponse.json()) as AccessPolicy;

  try {
    const opened = await replaceAccessPolicy(request, host.token, {
      restricted: false,
      allowed_emails: [],
    });
    expect(opened.status()).toBe(200);

    const existingAccount = await registerReady(request, existingEmail);

    await page.addInitScript(
      (token) => localStorage.setItem('kanleaf.session-token', token),
      host.token,
    );
    await page.goto('/host');

    await expect(
      page.getByRole('region', { name: 'Host Console' }),
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'Workspaces' }),
    ).toBeVisible();
    const workspaceTable = page.getByRole('table');
    await expect(
      workspaceTable.getByRole('columnheader', { name: 'Workspace' }),
    ).toBeVisible();
    await expect(
      workspaceTable.getByRole('columnheader', { name: 'Owner' }),
    ).toBeVisible();
    await expect(
      workspaceTable.getByRole('row').filter({ hasText: hostE2eEmail }).first(),
    ).toContainText(host.workspace.name);
    await expect(
      workspaceTable
        .getByRole('row')
        .filter({ hasText: existingEmail })
        .first(),
    ).toContainText(existingAccount.workspace.name);
    await page.getByRole('button', { name: 'Access', exact: true }).click();
    const restrictedAccess = page.getByLabel('Restricted access');
    const approvedEmailInput = page.getByRole('textbox', {
      name: 'Email address',
    });
    await expect(restrictedAccess).not.toBeChecked();
    await approvedEmailInput.fill(approvedEmail);
    await page.getByRole('button', { name: 'Add email' }).click();
    await restrictedAccess.check();
    await saveAccessPolicy(page);
    await expect(restrictedAccess).toBeChecked();
    const revokedExisting = await request.get('/api/session', {
      headers: {
        authorization: `Bearer ${existingAccount.token}`,
      },
    });
    expect(revokedExisting.status()).toBe(401);

    const deniedLogin = await login(request, existingEmail);
    expect(deniedLogin.status()).toBe(403);
    await expect(deniedLogin.json()).resolves.toMatchObject({
      error: { code: 'access_restricted' },
    });

    const deniedRegistration = await registerRaw(request, unlistedEmail);
    expect(deniedRegistration.status()).toBe(403);
    await expect(deniedRegistration.json()).resolves.toEqual({
      error: {
        code: 'access_restricted',
        message:
          'Access to this Kanleaf host is restricted. Contact the host administrator.',
      },
    });

    const approvedAccount = await registerReady(request, approvedEmail);
    const approvedSession = await request.get('/api/session', {
      headers: {
        authorization: `Bearer ${approvedAccount.token}`,
      },
    });
    expect(approvedSession.status()).toBe(200);

    await page.getByRole('button', { name: `Remove ${approvedEmail}` }).click();
    await saveAccessPolicy(page);

    const revokedApproved = await request.get('/api/session', {
      headers: {
        authorization: `Bearer ${approvedAccount.token}`,
      },
    });
    expect(revokedApproved.status()).toBe(401);

    const removedLogin = await login(request, approvedEmail);
    expect(removedLogin.status()).toBe(403);
    await expect(removedLogin.json()).resolves.toMatchObject({
      error: { code: 'access_restricted' },
    });

    await page.setViewportSize({ width: 700, height: 900 });
    await page.getByRole('button', { name: 'Switch account' }).click();
    const accountPopover = page.getByRole('dialog', {
      name: 'Switch account',
    });
    await expect(accountPopover).toBeVisible();
    const popoverBounds = await accountPopover.boundingBox();
    if (!popoverBounds) throw new Error('Account popover has no layout bounds');
    expect(popoverBounds.y).toBeGreaterThanOrEqual(0);
    expect(popoverBounds.y + popoverBounds.height).toBeLessThanOrEqual(900);
  } finally {
    const restored = await replaceAccessPolicy(
      request,
      host.token,
      originalPolicy,
    );
    expect(restored.status()).toBe(200);
  }
});

test('permanently deletes a Workspace through both Host confirmations', async ({
  page,
  request,
}) => {
  const suffix = `${Date.now()}-${test.info().workerIndex}`;
  const victimEmail = `delete-owner-${suffix}@example.com`;
  const host = await registerOrLogin(request, hostE2eEmail);
  const hostHeaders = { authorization: `Bearer ${host.token}` };
  const originalResponse = await request.get('/api/host/access', {
    headers: hostHeaders,
  });
  expect(originalResponse.status()).toBe(200);
  const originalPolicy = (await originalResponse.json()) as AccessPolicy;

  try {
    const opened = await replaceAccessPolicy(request, host.token, {
      restricted: false,
      allowed_emails: [],
    });
    expect(opened.status()).toBe(200);
    const victim = await registerReady(request, victimEmail);
    const victimHeaders = { authorization: `Bearer ${victim.token}` };

    const task = await request.post(
      `/api/workspaces/${victim.workspace.id}/tasks`,
      {
        headers: victimHeaders,
        data: { title: 'Markdown that must be deleted' },
      },
    );
    expect(task.status()).toBe(201);

    await page.addInitScript(
      (token) => localStorage.setItem('kanleaf.session-token', token),
      host.token,
    );
    await page.goto('/host');
    const victimRow = page
      .getByRole('row')
      .filter({ hasText: victimEmail })
      .first();
    await expect(victimRow).toContainText(victim.workspace.name);
    await victimRow
      .getByRole('button', {
        name: `Delete Workspace “${victim.workspace.name}” (/${victim.workspace.identifier})`,
      })
      .click();

    const dialog = page.getByRole('dialog');
    await expect(
      dialog.getByRole('heading', {
        name: `Delete “${victim.workspace.name}” (/${victim.workspace.identifier})?`,
      }),
    ).toBeVisible();
    await expect(dialog.getByText('This cannot be undone.')).toBeVisible();
    await expect(dialog.getByLabel('Workspace ID')).not.toBeVisible();
    await dialog.getByRole('button', { name: 'Continue' }).click();

    await expect(
      dialog.getByRole('heading', {
        name: `Confirm permanent deletion of “${victim.workspace.name}” (/${victim.workspace.identifier})`,
      }),
    ).toBeVisible();
    await dialog
      .getByLabel('Workspace ID')
      .fill(`${victim.workspace.identifier}-wrong`);
    await dialog.getByLabel('Host password', { exact: true }).fill(password);
    const deleteButton = dialog.getByRole('button', {
      name: `Permanently delete “${victim.workspace.name}” (/${victim.workspace.identifier})`,
    });
    await expect(deleteButton).toBeDisabled();
    await dialog.getByLabel('Workspace ID').fill(victim.workspace.identifier);

    const deletion = page.waitForResponse(
      (response) =>
        response.request().method() === 'DELETE' &&
        new URL(response.url()).pathname ===
          `/api/host/workspaces/${victim.workspace.id}`,
    );
    await deleteButton.click();
    expect((await deletion).status()).toBe(204);
    await expect(dialog).not.toBeVisible();
    await expect(victimRow).toHaveCount(0);
    await expect(
      page.getByRole('status').filter({
        hasText: `${victim.workspace.name} (/${victim.workspace.identifier}) was permanently deleted`,
      }),
    ).toHaveText(
      `${victim.workspace.name} (/${victim.workspace.identifier}) was permanently deleted`,
    );

    const ownerWorkspaces = await request.get('/api/workspaces', {
      headers: victimHeaders,
    });
    expect(ownerWorkspaces.status()).toBe(200);
    expect(await ownerWorkspaces.json()).toEqual([]);
    const identifierReuse = await request.post('/api/workspaces', {
      headers: victimHeaders,
      data: {
        name: 'Replacement Workspace',
        identifier: victim.workspace.identifier,
      },
    });
    expect(identifierReuse.status()).toBe(201);
    expect((await identifierReuse.json()).identifier).toBe(
      victim.workspace.identifier,
    );
  } finally {
    const restored = await replaceAccessPolicy(
      request,
      host.token,
      originalPolicy,
    );
    expect(restored.status()).toBe(200);
  }
});

async function registerOrLogin(
  request: APIRequestContext,
  email: string,
): Promise<ReadyAuthPayload> {
  const registration = await registerRaw(request, email);
  let authenticated: AuthPayload;
  if (registration.status() === 201) {
    authenticated = (await registration.json()) as AuthPayload;
  } else {
    expect(registration.status()).toBe(409);
    const loginResponse = await login(request, email);
    expect(loginResponse.status()).toBe(200);
    authenticated = (await loginResponse.json()) as AuthPayload;
  }
  return completeInitialSetup(request, authenticated);
}

async function registerReady(request: APIRequestContext, email: string) {
  const registration = await registerRaw(request, email);
  expect(registration.status()).toBe(201);
  return completeInitialSetup(
    request,
    (await registration.json()) as AuthPayload,
  );
}

async function completeInitialSetup(
  request: APIRequestContext,
  authenticated: AuthPayload,
): Promise<ReadyAuthPayload> {
  const headers = { authorization: `Bearer ${authenticated.token}` };
  let user = authenticated.user;

  if (user.setup_stage === 'account') {
    const accountSetup = await request.patch('/api/account/setup', {
      headers,
      data: { display_name: user.email.slice(0, user.email.indexOf('@')) },
    });
    expect(accountSetup.status()).toBe(200);
    user = (await accountSetup.json()) as AuthPayload['user'];
  }

  const workspaceList = await request.get('/api/workspaces', { headers });
  expect(workspaceList.status()).toBe(200);
  const workspaces = (await workspaceList.json()) as WorkspacePayload[];
  let workspace =
    workspaces.find(({ id }) => id === user.active_workspace_id) ??
    workspaces[0];

  if (!workspace) {
    const localPart = user.email.slice(0, user.email.indexOf('@'));
    const identifier = localPart
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48);
    const created = await request.post('/api/workspaces', {
      headers,
      data: { name: `${localPart} Workspace`, identifier },
    });
    expect(created.status()).toBe(201);
    workspace = (await created.json()) as WorkspacePayload;
    user = {
      ...user,
      active_workspace_id: workspace.id,
      setup_stage: user.setup_stage === 'complete' ? 'complete' : 'invite',
    };
  } else if (user.active_workspace_id !== workspace.id) {
    const activated = await request.post(
      `/api/workspaces/${workspace.id}/activate`,
      { headers },
    );
    expect(activated.status()).toBe(204);
  }

  if (user.setup_stage !== 'complete') {
    const completed = await request.post('/api/account/setup/complete', {
      headers,
    });
    expect(completed.status()).toBe(200);
  }

  const session = await request.get('/api/session', { headers });
  expect(session.status()).toBe(200);
  const sessionPayload = (await session.json()) as {
    user: AuthPayload['user'];
  };
  expect(sessionPayload.user.setup_stage).toBe('complete');
  expect(sessionPayload.user.active_workspace_id).toBe(workspace.id);
  return {
    token: authenticated.token,
    user: sessionPayload.user as ReadyAuthPayload['user'],
    workspace,
  };
}

function registerRaw(request: APIRequestContext, email: string) {
  return request.post('/api/auth/register', {
    data: { email, password },
  });
}

function login(request: APIRequestContext, email: string) {
  return request.post('/api/auth/login', {
    data: { email, password },
  });
}

function replaceAccessPolicy(
  request: APIRequestContext,
  token: string,
  policy: AccessPolicy,
) {
  return request.put('/api/host/access', {
    headers: { authorization: `Bearer ${token}` },
    data: policy,
  });
}

async function saveAccessPolicy(page: Page) {
  const saved = page.waitForResponse(
    (response) =>
      response.request().method() === 'PUT' &&
      new URL(response.url()).pathname === '/api/host/access',
  );
  page.once('dialog', (dialog) => void dialog.accept());
  await page.getByRole('button', { name: 'Save access policy' }).click();
  expect((await saved).status()).toBe(200);
  await expect(page.getByRole('status')).toHaveText('Access policy saved');
}
