import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from '@playwright/test';
import { hostE2eEmail } from './environment';

const password = 'playwright-password';

interface AuthPayload {
  token: string;
  user: {
    id: string;
    email: string;
    display_name: string;
    active_workspace_id: string;
    is_host: boolean;
  };
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

    const existing = await register(request, existingEmail);
    expect(existing.status()).toBe(201);
    const existingAccount = (await existing.json()) as AuthPayload;

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
    ).toContainText('Personal');
    await expect(
      workspaceTable
        .getByRole('row')
        .filter({ hasText: existingEmail })
        .first(),
    ).toContainText('Personal');
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

    const deniedRegistration = await register(request, unlistedEmail);
    expect(deniedRegistration.status()).toBe(403);
    await expect(deniedRegistration.json()).resolves.toEqual({
      error: {
        code: 'access_restricted',
        message:
          'Access to this Kanleaf host is restricted. Contact the host administrator.',
      },
    });

    const approvedRegistration = await register(request, approvedEmail);
    expect(approvedRegistration.status()).toBe(201);
    const approvedAccount = (await approvedRegistration.json()) as AuthPayload;
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
): Promise<AuthPayload> {
  const registration = await register(request, email);
  if (registration.status() === 201) {
    return (await registration.json()) as AuthPayload;
  }
  expect(registration.status()).toBe(409);

  const authenticated = await login(request, email);
  expect(authenticated.status()).toBe(200);
  return (await authenticated.json()) as AuthPayload;
}

function register(request: APIRequestContext, email: string) {
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
