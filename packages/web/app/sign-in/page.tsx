import { redirect } from 'next/navigation';

import { SignInForm } from '../../components/organisms/sign-in-form';
import { AuthLayout } from '../../components/templates/auth-layout';
import { hostedSignInUrlFrom } from '../../lib/hosted-sign-in';

// The hosted sign-in URL is runtime config: read on each request.
export const dynamic = 'force-dynamic';

/**
 * Sign in with the operator's email and password. Only the session cookie
 * stays in the browser. `?notice=signed-in-elsewhere` says the last session
 * ended because the operator signed in on another device. A hosted console
 * (AEOLUS_HOSTED_SIGN_IN_URL set) has no screen of its own here: it redirects
 * to the hosting service's sign-in at once, and never serves a password form.
 */
export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const hosted = hostedSignInUrlFrom(process.env);
  if (hosted !== undefined) {
    redirect(hosted);
  }
  const { notice } = await searchParams;
  return (
    <AuthLayout
      recovery={
        <>
          Forgot your password? Reset it on the server with{' '}
          <code className="inline-block rounded-xs bg-muted px-1.5 py-0.5 font-mono text-id whitespace-nowrap text-foreground">
            aeolus-server operator:reset-password
          </code>
        </>
      }
    >
      <SignInForm isSignedInElsewhere={notice === 'signed-in-elsewhere'} />
    </AuthLayout>
  );
}
