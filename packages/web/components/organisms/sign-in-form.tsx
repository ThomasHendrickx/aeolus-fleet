'use client';

import { signInInputSchema } from '@aeolus-fleet/common';
import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'next/navigation';
import { useSyncExternalStore } from 'react';
import { useForm } from 'react-hook-form';

import { useSignIn } from '../../lib/console';
import { signInRefusal } from '../../lib/sign-in';

const noSubscription = () => () => undefined;

/** False while the page is server HTML only, true once React runs in the browser. */
function useHydrated(): boolean {
  return useSyncExternalStore(
    noSubscription,
    () => true,
    () => false,
  );
}

/**
 * Sign in with the operator's email and password, checked with the schema the
 * server uses. Signing in crews argo and opens the fleet; a refusal keeps what
 * was typed.
 */
export function SignInForm() {
  const signIn = useSignIn();
  const router = useRouter();
  // Before hydration a native submit would send the form itself; the button waits for React.
  const isHydrated = useHydrated();
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(signInInputSchema),
    defaultValues: { email: '', password: '' },
  });

  const submit = handleSubmit((input) => {
    signIn.mutate(input, {
      onSuccess: () => {
        router.replace('/');
      },
    });
  });

  return (
    <>
      <form
        method="post"
        noValidate
        data-testid="sign-in-form"
        onSubmit={(event) => {
          void submit(event);
        }}
      >
        <p>
          <label htmlFor="sign-in-email">Email</label>
          <input
            id="sign-in-email"
            type="email"
            autoComplete="username"
            aria-invalid={errors.email ? true : undefined}
            aria-describedby={errors.email ? 'sign-in-email-error' : undefined}
            {...register('email')}
          />
          {errors.email ? <span id="sign-in-email-error">{errors.email.message}</span> : null}
        </p>
        <p>
          <label htmlFor="sign-in-password">Password</label>
          <input
            id="sign-in-password"
            type="password"
            autoComplete="current-password"
            aria-invalid={errors.password ? true : undefined}
            aria-describedby={errors.password ? 'sign-in-password-error' : undefined}
            {...register('password')}
          />
          {errors.password ? <span id="sign-in-password-error">{errors.password.message}</span> : null}
        </p>
        <button type="submit" disabled={!isHydrated || signIn.isPending}>
          Sign in
        </button>
      </form>
      {signIn.isError ? <p role="alert">{signInRefusal(signIn.error)}</p> : null}
    </>
  );
}
