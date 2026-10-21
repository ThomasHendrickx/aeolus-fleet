import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useTRPC } from '../../../lib/trpc';
import type { OwnSignInLogin } from '../ui/organisms/own-sign-in';

/** argo's own sign-in as Settings shows it: the email it signs in with, and saving a new email and password. */
export interface OwnSignIn {
  /** Undefined while the account loads, and for a session that is not argo's. */
  email: string | undefined;
  isSaving: boolean;
  isSaved: boolean;
  saveError: string | undefined;
  onSave: (login: OwnSignInLogin) => void;
}

/**
 * Reads the email argo signs in with and saves a new email and password
 * through `console.setLogin`; once saved, the account is read again so the
 * account menu shows the new email.
 */
export function useOwnSignIn(): OwnSignIn {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const account = useQuery(trpc.console.account.queryOptions());
  const setLogin = useMutation(
    trpc.console.setLogin.mutationOptions({
      onSuccess: () => queryClient.invalidateQueries({ queryKey: trpc.console.account.queryKey() }),
    }),
  );
  return {
    email: account.data?.kind === 'operator' ? account.data.email : undefined,
    isSaving: setLogin.isPending,
    isSaved: setLogin.isSuccess,
    saveError: setLogin.error?.message,
    onSave: (login) => {
      setLogin.mutate(login);
    },
  };
}
