import { apiRequest } from '../api/client';
import type { HealthResponse } from '../api/types';

const SERVER_URL_ENV = 'VITE_KANLEAF_SERVER_URL';
const SAME_ORIGIN_SERVER_URL = 'same-origin';
const HEALTH_TIMEOUT_MS = 8_000;

export function readConfiguredServerUrl(): string {
  const value = import.meta.env.VITE_KANLEAF_SERVER_URL;
  if (!value) {
    throw new Error(`Set ${SERVER_URL_ENV} in the repository root .env file`);
  }
  if (value === SAME_ORIGIN_SERVER_URL) {
    return normalizeServerUrl(window.location.origin);
  }
  return normalizeServerUrl(value);
}

export function normalizeServerUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error(`${SERVER_URL_ENV} must be a complete HTTP or HTTPS URL`);
  }

  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error(`${SERVER_URL_ENV} must use HTTP or HTTPS`);
  }
  if (url.username || url.password) {
    throw new Error(`${SERVER_URL_ENV} cannot contain credentials`);
  }
  if (url.search || url.hash) {
    throw new Error(`${SERVER_URL_ENV} cannot contain a query or fragment`);
  }

  return url.toString().replace(/\/$/, '');
}

export async function checkServerHealth(
  serverUrl: string,
  signal: AbortSignal,
): Promise<true> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  const timeout = window.setTimeout(abort, HEALTH_TIMEOUT_MS);
  signal.addEventListener('abort', abort, { once: true });
  if (signal.aborted) abort();

  try {
    const health = await apiRequest<HealthResponse>(serverUrl, '/api/health', {
      signal: controller.signal,
    });
    if (health.service !== 'kanleaf' || health.status !== 'ok') {
      throw new Error('The configured URL is not a healthy Kanleaf server');
    }
    return true;
  } finally {
    window.clearTimeout(timeout);
    signal.removeEventListener('abort', abort);
  }
}
