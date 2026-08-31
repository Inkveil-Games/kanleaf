interface ErrorEnvelope {
  error?: {
    code?: string;
    message?: string;
  };
}

interface ApiRequestOptions extends RequestInit {
  token?: string | null;
}

type UnauthorizedListener = (token: string) => void;

const unauthorizedListeners = new Set<UnauthorizedListener>();

export function subscribeToUnauthorizedRequests(
  listener: UnauthorizedListener,
) {
  unauthorizedListeners.add(listener);
  return () => {
    unauthorizedListeners.delete(listener);
  };
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

export async function apiRequest<T>(
  serverUrl: string,
  path: string,
  { token, headers: suppliedHeaders, ...options }: ApiRequestOptions = {},
): Promise<T> {
  const headers = new Headers(suppliedHeaders);
  if (
    options.body &&
    !(options.body instanceof FormData) &&
    !headers.has('content-type')
  ) {
    headers.set('content-type', 'application/json');
  }
  if (token) {
    headers.set('authorization', `Bearer ${token}`);
  }

  const response = await fetch(`${serverUrl}${path}`, {
    ...options,
    headers,
  });
  if (response.status === 401 && token) notifyUnauthorized(token);
  if (response.status === 204) {
    if (!response.ok) {
      throw new ApiError(response.status, 'request_failed', 'Request failed');
    }
    return undefined as T;
  }

  const payload = await readJson(response);
  if (!response.ok) {
    const envelope = payload as ErrorEnvelope;
    throw new ApiError(
      response.status,
      envelope.error?.code ?? 'request_failed',
      envelope.error?.message ??
        `Request failed with status ${response.status}`,
    );
  }
  return payload as T;
}

export async function apiDownload(
  serverUrl: string,
  path: string,
  token: string,
): Promise<{ blob: Blob; fileName: string | null }> {
  const response = await fetch(`${serverUrl}${path}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (response.status === 401) notifyUnauthorized(token);
  if (!response.ok) {
    const payload = (await readJson(response)) as ErrorEnvelope;
    throw new ApiError(
      response.status,
      payload.error?.code ?? 'request_failed',
      payload.error?.message ?? `Request failed with status ${response.status}`,
    );
  }
  return {
    blob: await response.blob(),
    fileName: attachmentFileName(response.headers.get('content-disposition')),
  };
}

function notifyUnauthorized(token: string) {
  for (const listener of unauthorizedListeners) listener(token);
}

function attachmentFileName(disposition: string | null) {
  const match = disposition?.match(/filename="([^"]+)"/i);
  return match?.[1] ?? null;
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    if (response.ok) {
      throw new ApiError(
        response.status,
        'invalid_response',
        'The server returned an invalid response',
      );
    }
    return {};
  }
}
