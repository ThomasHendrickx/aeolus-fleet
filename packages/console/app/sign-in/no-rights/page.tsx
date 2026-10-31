import Link from 'next/link';

import { Button } from '@aeolus-fleet/ui';
import { AuthCard } from '../../../features/sign-in/ui/organisms/auth-card';
import { hostedAccountUrlFrom } from '../../../lib/hosted-account-url';

export const dynamic = 'force-dynamic';

/** An account with no rights in the fleet, or in any (accounts design, F1): an organisation admin gives them, in Account. */
export default function NoRightsPage() {
  const accountUrl = hostedAccountUrlFrom(process.env);
  return (
    <AuthCard recovery={null}>
      <div className="flex flex-col gap-4" data-testid="sign-in-no-rights">
        <div className="flex flex-col gap-1.5">
          <h1 className="text-section font-semibold">No rights in this fleet</h1>
          <p className="text-body text-muted-foreground">You have no rights in this fleet. Ask an organisation admin.</p>
        </div>
        {accountUrl === undefined ? null : (
          <Button variant="secondary" nativeButton={false} render={<Link href={accountUrl} />} data-testid="sign-in-no-rights-account">
            Go to Account
          </Button>
        )}
      </div>
    </AuthCard>
  );
}
