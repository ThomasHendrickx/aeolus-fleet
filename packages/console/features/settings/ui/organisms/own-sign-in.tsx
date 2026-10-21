'use client';

import { newOperatorPasswordProblem, signInEmailProblem } from '@aeolus-fleet/common/rules';
import { CircleCheck, KeyRound } from 'lucide-react';
import { useForm } from 'react-hook-form';

import { Button } from '@aeolus-fleet/common/header';
import { Input } from '../../../../components/atoms/input';
import { Label } from '../../../../components/atoms/label';
import { InlineError } from '../../../../components/molecules/inline-error';

/** The email and password argo's own sign-in takes from here on. */
export interface OwnSignInLogin {
  email: string;
  password: string;
  /** The password argo signs in with now; none while it has none. */
  currentPassword?: string;
}

interface OwnSignInProps {
  /** The email argo signs in with now, filled in; null while argo signs in only with a link from the terminal. */
  email: string | null;
  /** argo has a password: the change asks for it first. */
  hasPassword: boolean;
  isSaving: boolean;
  /** The last save went through: says so until the next one. */
  isSaved: boolean;
  /** Why the last save failed, as the fleet says it. */
  saveError?: string;
  onSave: (login: OwnSignInLogin) => void;
}

const DIFFERENT_PASSWORDS = 'The two passwords differ';
const CURRENT_PASSWORD_REQUIRED = 'Enter your current password';

const FIELD_ERROR = 'text-meta text-destructive-text';

/**
 * Settings, Sign-in: the email and password of argo's own sign-in, on a
 * self-hosted fleet (accounts design, A1). The email is the user name. Both
 * are set together; the password twice, checked here as a hint by the rule
 * the server applies. While argo has a password, the change asks for it
 * first. A failed save keeps what was typed and says why.
 */
export function OwnSignIn({ email, hasPassword, isSaving, isSaved, saveError, onSave }: OwnSignInProps) {
  const {
    register,
    handleSubmit,
    getValues,
    formState: { errors },
  } = useForm({ defaultValues: { currentPassword: '', email: email ?? '', password: '', repeat: '' } });

  const submit = handleSubmit((input) => {
    onSave(hasPassword ? { email: input.email, password: input.password, currentPassword: input.currentPassword } : { email: input.email, password: input.password });
  });

  return (
    <section aria-labelledby="settings-sign-in" data-testid="settings-sign-in" className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
      <h2 id="settings-sign-in" className="flex items-center gap-2 text-body font-semibold [&_svg]:size-(--size-icon) [&_svg]:text-muted-foreground">
        <KeyRound aria-hidden />
        Sign-in
      </h2>
      <p className="text-body text-muted-foreground" data-testid="settings-sign-in-state">
        {email === null
          ? 'argo has no email and password yet: you signed in with a link from npx aeolus-core sign-in. Set them to sign in with them instead.'
          : 'The email and password you sign in to this console with, as argo.'}
      </p>
      <form
        noValidate
        data-testid="settings-sign-in-form"
        className="flex max-w-sm flex-col gap-4"
        onSubmit={(event) => {
          void submit(event);
        }}
      >
        {hasPassword ? (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="settings-sign-in-current">Current password</Label>
            <Input
              id="settings-sign-in-current"
              type="password"
              autoComplete="current-password"
              aria-invalid={errors.currentPassword ? true : undefined}
              aria-describedby={errors.currentPassword ? 'settings-sign-in-current-error' : undefined}
              {...register('currentPassword', { validate: (value) => value !== '' || CURRENT_PASSWORD_REQUIRED })}
            />
            {errors.currentPassword ? (
              <span id="settings-sign-in-current-error" className={FIELD_ERROR}>
                {errors.currentPassword.message}
              </span>
            ) : null}
          </div>
        ) : null}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="settings-sign-in-email">Email</Label>
          <Input
            id="settings-sign-in-email"
            type="email"
            autoComplete="username"
            placeholder="you@example.com"
            aria-invalid={errors.email ? true : undefined}
            aria-describedby={errors.email ? 'settings-sign-in-email-error' : undefined}
            {...register('email', { validate: (value) => signInEmailProblem(value) ?? true })}
          />
          {errors.email ? (
            <span id="settings-sign-in-email-error" className={FIELD_ERROR}>
              {errors.email.message}
            </span>
          ) : null}
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="settings-sign-in-password">New password</Label>
          <Input
            id="settings-sign-in-password"
            type="password"
            autoComplete="new-password"
            aria-invalid={errors.password ? true : undefined}
            aria-describedby={errors.password ? 'settings-sign-in-password-error' : undefined}
            {...register('password', { validate: (value) => newOperatorPasswordProblem(value) ?? true })}
          />
          {errors.password ? (
            <span id="settings-sign-in-password-error" className={FIELD_ERROR}>
              {errors.password.message}
            </span>
          ) : null}
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="settings-sign-in-repeat">Repeat the password</Label>
          <Input
            id="settings-sign-in-repeat"
            type="password"
            autoComplete="new-password"
            aria-invalid={errors.repeat ? true : undefined}
            aria-describedby={errors.repeat ? 'settings-sign-in-repeat-error' : undefined}
            {...register('repeat', { validate: (value) => value === getValues('password') || DIFFERENT_PASSWORDS })}
          />
          {errors.repeat ? (
            <span id="settings-sign-in-repeat-error" className={FIELD_ERROR}>
              {errors.repeat.message}
            </span>
          ) : null}
        </div>
        <div>
          <Button type="submit" variant="primary" isLoading={isSaving} data-testid="settings-sign-in-save">
            {isSaving ? 'Saving…' : 'Save email and password'}
          </Button>
        </div>
        {saveError !== undefined && <InlineError variant="section" title="Couldn’t save the email and password" description={saveError} />}
        {isSaved && saveError === undefined && !isSaving ? (
          <p role="status" data-testid="settings-sign-in-saved" className="flex items-center gap-1.5 text-meta text-tone-ok-fg [&_svg]:size-(--size-icon-sm)">
            <CircleCheck aria-hidden />
            Saved. Sign in with this email and password from now on.
          </p>
        ) : null}
      </form>
    </section>
  );
}
