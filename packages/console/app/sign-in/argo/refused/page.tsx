import Link from 'next/link';

import { Button } from '@aeolus-fleet/ui';
import { AuthCard } from '../../../../features/sign-in/ui/organisms/auth-card';

export const dynamic = 'force-dynamic';

/** An account pagasae does not allow as argo of the fleet (accounts design, F4). */
export default function ArgoRefusedPage() {
  return (
    <AuthCard recovery={null}>
      <div className="flex flex-col gap-4" data-testid="sign-in-argo-refused">
        <div className="flex flex-col gap-1.5">
          <h1 className="text-section font-semibold">Not allowed as argo</h1>
          <p className="text-body text-muted-foreground">Your account may not sign in as argo of this fleet.</p>
        </div>
        <Button variant="secondary" nativeButton={false} render={<Link href="/" />} data-testid="sign-in-argo-refused-back">
          Back to the console
        </Button>
      </div>
    </AuthCard>
  );
}
