import { Button } from '@aeolus-fleet/ui';
import Link from 'next/link';
import { AuthCard } from '../../../features/sign-in/ui/organisms/auth-card';

export const dynamic = 'force-dynamic';

/** A switch to another fleet could not end argo's sign-in, so nothing changed: the console stays in the fleet it was in, signed in as argo. */
export default function SignInSwitchFailedPage() {
  return (
    <AuthCard recovery={null}>
      <div className="flex flex-col gap-4" data-testid="sign-in-switch-failed">
        <div className="flex flex-col gap-1.5">
          <h1 className="text-section font-semibold">The switch did not happen</h1>
          <p className="text-body text-muted-foreground">
            Switching to the other fleet ends your sign-in as argo, and that could not be done. You are still signed in as argo in this fleet. Go back, choose Sign out of argo in the avatar menu, then open the other fleet again.
          </p>
        </div>
        <Button variant="primary" nativeButton={false} render={<Link href="/" />} data-testid="sign-in-switch-failed-back">
          Back to the console
        </Button>
      </div>
    </AuthCard>
  );
}
