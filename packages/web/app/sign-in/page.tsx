'use client';

import { useMutation } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useState, useSyncExternalStore, type SubmitEvent } from 'react';

import { trpcErrorCode } from '../../lib/errors';
import { useTRPC } from '../../lib/trpc';

const MESSAGES: Record<string, string> = {
  UNAUTHORIZED: 'That secret is not valid.',
  FORBIDDEN: 'Only argo, the operator ship, signs in to the console.',
  TOO_MANY_REQUESTS: 'Too many attempts. Wait a minute, then try again.',
  BAD_REQUEST: "Paste argo's secret.",
};

const noSubscription = () => () => undefined;

/** False while the page is server HTML only, true once React runs in the browser. */
function useHydrated(): boolean {
  return useSyncExternalStore(
    noSubscription,
    () => true,
    () => false,
  );
}

/** Sign in by pasting argo's secret. The secret is sent once and never kept in the browser. */
export default function SignInPage() {
  const trpc = useTRPC();
  // Before hydration a native submit would send the form itself; the button waits for React.
  const hydrated = useHydrated();
  const router = useRouter();
  const [secret, setSecret] = useState('');
  const signIn = useMutation(
    trpc.console.signIn.mutationOptions({
      onSuccess: () => {
        setSecret('');
        router.replace('/');
      },
    }),
  );

  function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    signIn.mutate({ secret });
  }

  const error = signIn.isError
    ? (MESSAGES[trpcErrorCode(signIn.error) ?? ''] ?? `Sign-in failed: ${signIn.error.message}`)
    : undefined;

  return (
    <main>
      <h1>Sign in to Aeolus</h1>
      <form method="post" onSubmit={submit}>
        <label htmlFor="secret">argo&apos;s secret</label>
        <input
          id="secret"
          name="secret"
          type="password"
          autoComplete="off"
          required
          value={secret}
          onChange={(event) => {
            setSecret(event.target.value);
          }}
        />
        <button type="submit" disabled={!hydrated || signIn.isPending}>
          Sign in
        </button>
      </form>
      {error ? <p role="alert">{error}</p> : null}
    </main>
  );
}
