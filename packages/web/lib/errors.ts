/** The error data of a failed tRPC call, when it has any. */
function errorData(error: unknown): Record<string, unknown> | undefined {
  if (typeof error !== 'object' || error === null || !('data' in error)) {
    return undefined;
  }
  const { data } = error;
  return typeof data === 'object' && data !== null ? Object.fromEntries(Object.entries(data)) : undefined;
}

/** The tRPC error code of a failed call, such as UNAUTHORIZED, when there is one. */
export function trpcErrorCode(error: unknown): string | undefined {
  const code = errorData(error)?.code;
  return typeof code === 'string' ? code : undefined;
}

/** Whether the console session ended because the operator signed in somewhere else. */
export function isSignedInElsewhere(error: unknown): boolean {
  return errorData(error)?.refusal === 'SIGNED_IN_ELSEWHERE';
}

/** When a rate-limited sign-in may try again, as the server says; undefined when it does not say. */
export function retryAtOf(error: unknown): Date | undefined {
  const retryAt = errorData(error)?.retryAt;
  if (typeof retryAt !== 'string') {
    return undefined;
  }
  const at = new Date(retryAt);
  return Number.isNaN(at.getTime()) ? undefined : at;
}
