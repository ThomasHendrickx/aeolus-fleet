import Link from 'next/link';

import { Button } from '../../../components/atoms/button';
import { AuthCard } from '../../../features/sign-in/organisms/auth-card';
import { gatewayUrlFrom } from '../../../lib/gateway-url';
import { hostedAccountUrlFrom } from '../../../lib/hosted-account-url';

export const dynamic = 'force-dynamic';

/** An account with rights in the fleet but no fleet:read (accounts design, A8): the console has nothing for it; the gateway and Account do. */
export default function NothingToManagePage() {
  const accountUrl = hostedAccountUrlFrom(process.env);
  const gatewayUrl = gatewayUrlFrom(process.env);
  return (
    <AuthCard recovery={null}>
      <div className="flex flex-col gap-4" data-testid="sign-in-nothing-to-manage">
        <div className="flex flex-col gap-1.5">
          <h1 className="text-section font-semibold">Nothing to manage here</h1>
          <p className="text-body text-muted-foreground">Your account has rights in this fleet, but none to see it in the console.</p>
        </div>
        {gatewayUrl === undefined ? null : (
          <Button variant="primary" nativeButton={false} render={<Link href={gatewayUrl} />} data-testid="sign-in-nothing-to-manage-gateway">
            Go to the gateway
          </Button>
        )}
        {accountUrl === undefined ? null : (
          <Button variant="secondary" nativeButton={false} render={<Link href={accountUrl} />} data-testid="sign-in-nothing-to-manage-account">
            Go to Account
          </Button>
        )}
      </div>
    </AuthCard>
  );
}
