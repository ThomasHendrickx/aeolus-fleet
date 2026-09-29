/** The tRPC error code of a failed call, such as UNAUTHORIZED, when there is one. */
export function trpcErrorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('data' in error)) {
    return undefined;
  }
  const { data } = error as { data?: { code?: unknown } | null };
  return typeof data?.code === 'string' ? data.code : undefined;
}
