'use client';

import { useQuery, type UseQueryOptions, type UseQueryResult } from '@tanstack/react-query';

import { useSignInWhenSessionEnds } from './session';

/**
 * A console read as a page asks it (lib/fetch-console-read.ts): a query that
 * sends the operator to sign in once the read is refused because the session
 * ended, as any call refused for want of a session does.
 */
export function useConsoleRead<T>(options: UseQueryOptions<T>): UseQueryResult<T> {
  const query = useQuery(options);
  useSignInWhenSessionEnds([query.error]);
  return query;
}
