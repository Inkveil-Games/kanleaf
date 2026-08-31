import { expect, test } from '@playwright/test';

test('serves the browser client and API from one origin', async ({
  page,
  request,
}) => {
  await page.goto('/workspace/inbox');

  await expect(
    page.getByRole('heading', { name: 'Sign in to Kanleaf' }),
  ).toBeVisible();

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
