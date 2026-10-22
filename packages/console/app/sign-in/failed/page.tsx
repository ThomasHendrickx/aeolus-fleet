import Link from 'next/link';

import { Button } from '@aeolus-fleet/common/header';
import { AuthCard } from '../../../features/sign-in/ui/organisms/auth-card';
import { hostedSignInUrlFrom } from '../../../lib/hosted-sign-in';
import { pagasaeFrom } from '../../../lib/pagasae';

// The hosted sign-in URL is runtime config: read on each request.
export const dynamic = 'force-dynamic';

/**
 * A sign-in link did not go through (its ticket was used, expired or
 * unknown). Hosted, the operator starts again at the hosting service.
 * Where pagasae runs, an account's sign-in did not go through, and it signs
 * in again: there is no argo's own sign-in. Otherwise the link came from the
 * terminal, and a new one does too (accounts design, A1).
 */
export default function SignInFailedPage() {
  const hosted = hostedSignInUrlFrom(process.env);
  if (hosted === undefined && pagasaeFrom(process.env) !== undefined) {
    return (
      <AuthCard recovery={null}>
        <div className="flex flex-col gap-4" data-testid="sign-in-failed">
          <div className="flex flex-col gap-1.5">
            <h1 className="text-section font-semibold">We couldn’t sign you in</h1>
            <p className="text-body text-muted-foreground">Your sign-in didn’t go through. Sign in again.</p>
          </div>
          {/* A plain link: the sign-in starts on the server, which no client navigation reaches. */}
          <Button variant="primary" nativeButton={false} render={<a href="/sign-in/start">Sign in again</a>} data-testid="sign-in-failed-again">
            Sign in again
          </Button>
        </div>
      </AuthCard>
    );
  }
  if (hosted === undefined) {
    return (
      <AuthCard recovery={null}>
        <div className="flex flex-col gap-4" data-testid="sign-in-failed">
          <div className="flex flex-col gap-1.5">
            <h1 className="text-section font-semibold">We couldn’t sign you in</h1>
            <p className="text-body text-muted-foreground">This link has expired. Run npx aeolus-core sign-in for a new one.</p>
          </div>
          <Button variant="primary" nativeButton={false} render={<Link href="/sign-in" />} data-testid="sign-in-failed-again">
            Sign in with email and password
          </Button>
        </div>
      </AuthCard>
    );
  }
  return (
    <AuthCard recovery={null}>
      <div className="flex flex-col gap-4" data-testid="sign-in-failed">
        <div className="flex flex-col gap-1.5">
          <h1 className="text-section font-semibold">We couldn’t sign you in</h1>
          <p className="text-body text-muted-foreground">The sign-in from your account didn’t go through. Start again from there.</p>
        </div>
        <Button variant="primary" nativeButton={false} render={<Link href={hosted} />} data-testid="sign-in-failed-again">
          Go to sign in
        </Button>
      </div>
    </AuthCard>
  );
}
