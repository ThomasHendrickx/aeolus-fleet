import { cookies } from 'next/headers';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { Button } from '@aeolus-fleet/common/header';
import { SignedInElsewhereNotice } from '../../features/sign-in/molecules/signed-in-elsewhere-notice';
import { SignInForm } from '../../features/sign-in/organisms/sign-in-form';
import { AuthCard } from '../../features/sign-in/organisms/auth-card';
import { isArgoAllowed } from '../../lib/argo-sign-in';
import { hostedSignInUrlFrom } from '../../lib/hosted-sign-in';
import { returnPathOf } from '../../lib/return-path';
import { pagasaeFrom } from '../../lib/pagasae';

// The hosted sign-in URL is runtime config: read on each request.
export const dynamic = 'force-dynamic';

/**
 * Sign in with the operator's email and password, or, without one, with a
 * link from aeolus-core sign-in (accounts design, A1). Only the session cookie
 * stays in the browser. `?notice=signed-in-elsewhere` says the last session
 * ended because the operator signed in on another device. A hosted console
 * (AEOLUS_HOSTED_SIGN_IN_URL set) never serves a password form: it redirects
 * to the hosting service's sign-in at once, or, with the notice, shows the
 * notice and a link there, since the hosting service would not say it.
 * Where the console signs accounts in through pagasae (accounts design, F1),
 * it offers that sign-in instead, and says so after a sign-out. With
 * `?notice=ended` it says the account's sign-in ended (A6), and signs in again
 * back to `returnTo`, the page it was on. To an account allowed as argo of the
 * fleet, it offers Sign in as argo too (accounts design, A7), the way in when
 * acting as the account cannot help.
 */
/** pagasae's sign-in, coming back to the console page given, when one is. */
function startPathOf(returnTo: string | string[] | undefined): string {
  return typeof returnTo === 'string' ? `/sign-in/start?${new URLSearchParams({ returnTo: returnPathOf(returnTo) }).toString()}` : '/sign-in/start';
}

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { notice, signed, returnTo } = await searchParams;
  const pagasae = pagasaeFrom(process.env);
  if (pagasae !== undefined) {
    const canSignInAsArgo = await isArgoAllowed(pagasae, (await cookies()).toString());
    return (
      <AuthCard recovery={null}>
        <div className="flex flex-col gap-5" data-testid="sign-in-account">
          <h1 className="text-heading font-semibold max-sm:text-title-touch">Sign in to Aeolus</h1>
          {signed === 'out' ? (
            <p role="status" data-testid="sign-in-signed-out" className="text-body text-muted-foreground">
              You signed out of every Aeolus app.
            </p>
          ) : null}
          {notice === 'ended' ? (
            <p role="status" data-testid="sign-in-ended" className="text-body text-muted-foreground">
              Your sign-in ended.
            </p>
          ) : null}
          {/* A plain link: the sign-in starts on the server, which no client navigation reaches. */}
          <Button variant="primary" nativeButton={false} render={<a href={startPathOf(returnTo)}>Sign in with your account</a>} data-testid="sign-in-account-start">
            Sign in with your account
          </Button>
          {canSignInAsArgo ? (
            <form method="post" action="/sign-in/argo" className="flex flex-col">
              <Button type="submit" variant="secondary" data-testid="sign-in-argo-start">
                Sign in as argo
              </Button>
            </form>
          ) : null}
        </div>
      </AuthCard>
    );
  }
  const hosted = hostedSignInUrlFrom(process.env);
  const isSignedInElsewhere = notice === 'signed-in-elsewhere';
  if (hosted !== undefined && !isSignedInElsewhere) {
    redirect(hosted);
  }
  if (hosted !== undefined) {
    return (
      <AuthCard recovery={null}>
        <div className="flex flex-col gap-5">
          <h1 className="text-heading font-semibold max-sm:text-title-touch">Sign in to Aeolus</h1>
          <SignedInElsewhereNotice />
          <Button variant="primary" nativeButton={false} render={<Link href={hosted} />} data-testid="sign-in-elsewhere-again">
            Go to sign in
          </Button>
        </div>
      </AuthCard>
    );
  }
  return (
    <AuthCard
      recovery={
        <>
          No password yet, or forgot it? Get a sign-in link on the server with{' '}
          <code className="inline-block rounded-xs bg-muted px-1.5 py-0.5 font-mono text-id whitespace-nowrap text-foreground">
            aeolus-core sign-in
          </code>
        </>
      }
    >
      <SignInForm isSignedInElsewhere={isSignedInElsewhere} />
    </AuthCard>
  );
}
