interface ErrorEnvelope {
  error?: {
    code?: string;
    message?: string;
  };
}

interface ApiRequestOptions extends RequestInit {
  token?: string | null;
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
  if (options.body && !headers.has('content-type')) {
    headers.set('content-type', 'application/json');
  }
  if (token) {
    headers.set('authorization', `Bearer ${token}`);
  }

  const response = await fetch(`${serverUrl}${path}`, {
    ...options,
    headers,
  });
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
