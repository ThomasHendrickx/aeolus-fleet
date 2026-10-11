import Link from 'next/link';
import { redirect } from 'next/navigation';

import { Button } from '../../../components/atoms/button';
import { AuthCard } from '../../../features/sign-in/organisms/auth-card';
import { hostedSignInUrlFrom } from '../../../lib/hosted-sign-in';

// The hosted sign-in URL is runtime config: read on each request.
export const dynamic = 'force-dynamic';

/**
 * The hosted hand-off did not go through (the sign-in ticket was used,
 * expired or unknown): the operator starts again at the hosting service. A
 * self-hosted console has no hand-off, so this page sends to its own sign-in.
 */
export default function SignInFailedPage() {
  const hosted = hostedSignInUrlFrom(process.env);
  if (hosted === undefined) {
    redirect('/sign-in');
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
