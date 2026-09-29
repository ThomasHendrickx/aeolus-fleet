import { useMutation } from '@tanstack/react-query';

import { useTRPC } from './trpc';

/**
 * Signs in with the operator's email and password. The server answers with the
 * session cookie; the browser never holds more than that.
 */
export function useSignIn() {
  const trpc = useTRPC();
  return useMutation(trpc.console.signIn.mutationOptions());
}
