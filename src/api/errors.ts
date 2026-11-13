/** Error raised for any failed call to the object storage service. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly requestId?: string;

  constructor(message: string, status: number, code: string, requestId?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.requestId = requestId;
  }
}

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    return error.code && !error.code.startsWith('HTTP_') && error.code !== 'NetworkError'
      ? `${error.message} (${error.code})`
      : error.message;
  }
  if (error instanceof Error) return error.message;
  return String(error);
}

export function isAuthError(error: unknown): boolean {
  return error instanceof ApiError && error.status === 401;
}
