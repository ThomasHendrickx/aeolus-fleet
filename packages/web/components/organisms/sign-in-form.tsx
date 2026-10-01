'use client';

import { signInInputSchema } from '@aeolus-fleet/common';
import { zodResolver } from '@hookform/resolvers/zod';
import { CircleAlert, Timer } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useSyncExternalStore } from 'react';
import { useForm } from 'react-hook-form';

import { classNames } from '../../lib/class-names';
import { trpcErrorCode } from '../../lib/errors';
import { useSignIn } from '../../lib/console';
import { signInRefusal } from '../../lib/sign-in';
import { Button } from '../atoms/button';
import { Input } from '../atoms/input';
import { Label } from '../atoms/label';

const noSubscription = () => () => undefined;

/** False while the page is server HTML only, true once React runs in the browser. */
function useHydrated(): boolean {
  return useSyncExternalStore(
    noSubscription,
    () => true,
    () => false,
  );
}

const FIELD_ERROR = 'text-meta text-destructive-text';

/**
 * Sign in with the operator's email and password, checked with the schema the
 * server uses (docs/design/png/SignInForm.png). Signing in crews argo and opens
 * the fleet; a refusal shows one notice above the fields and keeps what was
 * typed.
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

  // Rate limiting is a wait, not a mistake: it takes the waiting tone (docs/design/conventions.md, "Alert tone").
  const isRateLimited = trpcErrorCode(signIn.error) === 'TOO_MANY_REQUESTS';

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h1 className="text-heading font-semibold max-sm:text-title-touch">Sign in to Aeolus</h1>
        <p className="text-meta text-muted-foreground">Use your operator account.</p>
      </div>
      {signIn.isError ? (
        <div
          className={classNames(
            'flex gap-2.5 rounded-lg border px-3.5 py-3 text-meta',
            isRateLimited
              ? 'border-tone-waiting-border bg-tone-waiting-bg text-tone-waiting-fg'
              : 'border-tone-attention-border bg-tone-attention-bg text-tone-attention-fg',
          )}
        >
          {isRateLimited ? (
            <Timer aria-hidden className="mt-0.5 size-(--size-icon-sm) shrink-0" />
          ) : (
            <CircleAlert aria-hidden className="mt-0.5 size-(--size-icon-sm) shrink-0" />
          )}
          <p role="alert" className="font-medium">
            {signInRefusal(signIn.error)}
          </p>
        </div>
      ) : null}
      <form
        method="post"
        noValidate
        data-testid="sign-in-form"
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          void submit(event);
        }}
      >
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="sign-in-email">Email</Label>
          <Input
            id="sign-in-email"
            type="email"
            autoComplete="username"
            placeholder="you@example.com"
            className="max-sm:h-(--size-control-touch) max-sm:text-input-touch"
            aria-invalid={errors.email ? true : undefined}
            aria-describedby={errors.email ? 'sign-in-email-error' : undefined}
            {...register('email')}
          />
          {errors.email ? (
            <span id="sign-in-email-error" className={FIELD_ERROR}>
              {errors.email.message}
            </span>
          ) : null}
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="sign-in-password">Password</Label>
          <Input
            id="sign-in-password"
            type="password"
            autoComplete="current-password"
            className="max-sm:h-(--size-control-touch) max-sm:text-input-touch"
            aria-invalid={errors.password ? true : undefined}
            aria-describedby={errors.password ? 'sign-in-password-error' : undefined}
            {...register('password')}
          />
          {errors.password ? (
            <span id="sign-in-password-error" className={FIELD_ERROR}>
              {errors.password.message}
            </span>
          ) : null}
        </div>
        <Button
          type="submit"
          variant="primary"
          className="mt-1 w-full max-sm:h-(--size-control-touch)"
          disabled={!isHydrated}
          isLoading={signIn.isPending}
        >
          Sign in
        </Button>
      </form>
    </div>
  );
}
