import type { AuramApi, ErrorCode, IpcResult } from '../../../shared/ipc';

export class ApiError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export function getApi(): AuramApi {
  if (!window.auram) throw new ApiError('unknown', 'Launcher bridge unavailable');
  return window.auram;
}

/** Unwraps an IPC result, throwing an ApiError for failures. */
export async function call<T>(request: (api: AuramApi) => Promise<IpcResult<T>>): Promise<T> {
  const result = await request(getApi());
  if (!result.ok) throw new ApiError(result.error.code, result.error.message);
  return result.value;
}

export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
