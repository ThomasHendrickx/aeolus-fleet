import Link from 'next/link';

import { Button } from '@aeolus-fleet/common/header';
import { AuthCard } from '../../../features/sign-in/organisms/auth-card';
import { hostedSignInUrlFrom } from '../../../lib/hosted-sign-in';

// The hosted sign-in URL is runtime config: read on each request.
export const dynamic = 'force-dynamic';

/**
 * A sign-in link did not go through (its ticket was used, expired or
 * unknown). Hosted, the operator starts again at the hosting service.
 * Self-hosted, the link came from the terminal, and a new one does too
 * (accounts design, A1).
 */
export default function SignInFailedPage() {
  const hosted = hostedSignInUrlFrom(process.env);
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
