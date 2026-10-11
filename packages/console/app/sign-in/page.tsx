import Link from 'next/link';
import { redirect } from 'next/navigation';

import { Button } from '../../components/atoms/button';
import { SignedInElsewhereNotice } from '../../features/sign-in/molecules/signed-in-elsewhere-notice';
import { SignInForm } from '../../features/sign-in/organisms/sign-in-form';
import { AuthLayout } from '../../components/templates/auth-layout';
import { hostedSignInUrlFrom } from '../../lib/hosted-sign-in';

// The hosted sign-in URL is runtime config: read on each request.
export const dynamic = 'force-dynamic';

/**
 * Sign in with the operator's email and password. Only the session cookie
 * stays in the browser. `?notice=signed-in-elsewhere` says the last session
 * ended because the operator signed in on another device. A hosted console
 * (AEOLUS_HOSTED_SIGN_IN_URL set) never serves a password form: it redirects
 * to the hosting service's sign-in at once, or, with the notice, shows the
 * notice and a link there, since the hosting service would not say it.
 */
export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const hosted = hostedSignInUrlFrom(process.env);
  const { notice } = await searchParams;
  const isSignedInElsewhere = notice === 'signed-in-elsewhere';
  if (hosted !== undefined && !isSignedInElsewhere) {
    redirect(hosted);
  }
  if (hosted !== undefined) {
    return (
      <AuthLayout recovery={null}>
        <div className="flex flex-col gap-5">
          <h1 className="text-heading font-semibold max-sm:text-title-touch">Sign in to Aeolus</h1>
          <SignedInElsewhereNotice />
          <Button variant="primary" nativeButton={false} render={<Link href={hosted} />} data-testid="sign-in-elsewhere-again">
            Go to sign in
          </Button>
        </div>
      </AuthLayout>
    );
  }
  return (
    <AuthLayout
      recovery={
        <>
          Forgot your password? Reset it on the server with{' '}
          <code className="inline-block rounded-xs bg-muted px-1.5 py-0.5 font-mono text-id whitespace-nowrap text-foreground">
            aeolus-core operator:reset-password
          </code>
        </>
      }
    >
      <SignInForm isSignedInElsewhere={isSignedInElsewhere} />
    </AuthLayout>
  );
}
