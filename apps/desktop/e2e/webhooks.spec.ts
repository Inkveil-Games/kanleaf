import { createHmac, randomUUID } from 'node:crypto';
import { createServer, type IncomingHttpHeaders } from 'node:http';
import { expect, test } from '@playwright/test';
import { serverUrl } from './environment';

test('creates a Workspace webhook, saves its secret, and delivers a signed test', async ({
  page,
  request,
}, testInfo) => {
  const received: { headers: IncomingHttpHeaders; body: Buffer }[] = [];
  const receiver = createServer((incoming, response) => {
    const chunks: Buffer[] = [];
    incoming.on('data', (chunk: Buffer) => chunks.push(chunk));
    incoming.on('end', () => {
      received.push({ headers: incoming.headers, body: Buffer.concat(chunks) });
      response.writeHead(204).end();
    });
  });
  await new Promise<void>((resolve) =>
    receiver.listen(0, '127.0.0.1', resolve),
  );
  const address = receiver.address();
  if (!address || typeof address === 'string')
    throw new Error('Local receiver address unavailable');
  try {
    const email = `webhook-${randomUUID()}@example.com`;
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
          data: { display_name: 'Webhook tester' },
        })
      ).status(),
    ).toBe(200);
    const created = await request.post(`${serverUrl}/api/workspaces`, {
      headers,
      data: {
        name: 'Webhook Workspace',
        identifier: `hooks-${randomUUID().slice(0, 8)}`,
      },
    });
    expect(created.status()).toBe(201);
    const workspace = (await created.json()) as {
      id: string;
      identifier: string;
    };
    expect(
      (
        await request.post(`${serverUrl}/api/account/setup/complete`, {
          headers,
        })
      ).status(),
    ).toBe(200);
    await page.goto(`/developer/w/${workspace.identifier}`);
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password', { exact: true }).fill(password);
    await page.locator('form button[type="submit"]').click();
    await page.getByRole('link', { name: 'Open Webhooks' }).click();
    await expect(page.getByText('No webhooks yet')).toBeVisible();
    await page
      .getByRole('button', { name: 'Create webhook', exact: true })
      .click();
    await expect(page).toHaveURL(
      new RegExp(`/developer/w/${workspace.identifier}/webhooks/new$`),
    );
    await page.getByLabel('Name', { exact: true }).fill('Controlled receiver');
    await page
      .getByLabel('Endpoint URL', { exact: true })
      .fill(`http://127.0.0.1:${address.port}/receive`);
    await page
      .getByRole('checkbox', { name: 'Task updated', exact: true })
      .click();
    await expect(page.getByLabel('JSON request body')).toContainText(
      'task.updated',
    );
    await page.screenshot({
      path: testInfo.outputPath('webhook-create-wide-light.png'),
    });
    await page.setViewportSize({ width: 480, height: 720 });
    await page.evaluate(() =>
      document.documentElement.setAttribute('data-theme', 'dark'),
    );
    await page
      .getByRole('heading', { name: 'Payload preview' })
      .scrollIntoViewIfNeeded();
    await page.screenshot({
      path: testInfo.outputPath('webhook-preview-narrow-dark.png'),
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.setViewportSize({ width: 960, height: 640 });
    await page
      .getByRole('button', { name: 'Create webhook', exact: true })
      .click();
    const secret = await page
      .getByRole('region', { name: 'Signing secret' })
      .locator('code')
      .textContent();
    expect(secret).toMatch(/^klf_whsec_/);
    await expect(page.getByText(/Copy this secret now/)).toBeVisible();
    await page.getByRole('link', { name: 'Open webhook' }).click();
    await expect(
      page.getByRole('heading', { name: 'Controlled receiver', exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText(secret ?? '', { exact: true }),
    ).not.toBeVisible();
    const detailUrl = page.url();
    await page.reload();
    await expect(page).toHaveURL(detailUrl);
    await page
      .getByRole('button', { name: 'Send test webhook', exact: true })
      .click();
    const deliveries = page.getByRole('region', { name: 'Recent deliveries' });
    await expect(deliveries.getByText(/Succeeded · HTTP 204/)).toBeVisible();
    await expect(
      deliveries.getByText('1 attempt', { exact: true }),
    ).toBeVisible();
    expect(received).toHaveLength(1);
    const captured = received[0];
    expect(captured.headers['x-kanleaf-event']).toBe('webhook.test');
    const expected = createHmac('sha256', secret ?? '')
      .update(`${captured.headers['x-kanleaf-timestamp']}.`)
      .update(captured.body)
      .digest('hex');
    expect(captured.headers['x-kanleaf-signature']).toBe(`v1=${expected}`);
    expect(JSON.parse(captured.body.toString())).toMatchObject({
      version: 2,
      type: 'webhook.test',
      workspace: { id: workspace.id, identifier: workspace.identifier },
      data: { message: 'Kanleaf webhook test' },
    });
    await page.evaluate(() =>
      document.documentElement.setAttribute('data-theme', 'dark'),
    );
    await page.screenshot({
      path: testInfo.outputPath('webhook-detail-minimum-dark.png'),
    });
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.evaluate(() =>
      document.documentElement.setAttribute('data-theme', 'light'),
    );
    await page.screenshot({
      path: testInfo.outputPath('webhook-detail-wide-light.png'),
    });
    await page
      .getByRole('button', { name: 'Back to Webhooks', exact: true })
      .click();
    await expect(
      page.getByRole('link', { name: 'Controlled receiver', exact: true }),
    ).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath('webhook-list-wide-light.png'),
    });
    await page.setViewportSize({ width: 480, height: 720 });
    await page.evaluate(() =>
      document.documentElement.setAttribute('data-theme', 'dark'),
    );
    await page.screenshot({
      path: testInfo.outputPath('webhook-list-narrow-dark.png'),
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page
      .getByRole('button', { name: 'Open navigation', exact: true })
      .click();
    const drawer = page.getByRole('dialog', {
      name: 'Workspace navigation',
      exact: true,
    });
    await expect(
      drawer
        .getByLabel('Developer footer')
        .getByRole('link', { name: 'Back to Workspace' }),
    ).toBeVisible();
    await expect(drawer).toHaveCSS('transform', 'none');
    await page.screenshot({
      path: testInfo.outputPath('webhook-drawer-narrow-dark.png'),
    });
  } finally {
    receiver.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      receiver.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
