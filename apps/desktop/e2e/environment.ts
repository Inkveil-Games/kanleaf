export const serverUrl =
  process.env.KANLEAF_E2E_SERVER_URL ?? 'http://127.0.0.1:3112';

export const serverAddress = new URL(serverUrl).host;

export const hostE2eEmail =
  process.env.KANLEAF_E2E_HOST_EMAIL?.trim().toLowerCase() ||
  'host-e2e@example.com';
