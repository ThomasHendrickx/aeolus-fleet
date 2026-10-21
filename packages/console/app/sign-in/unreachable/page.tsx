import { Button } from '@aeolus-fleet/common/header';
import { AuthCard } from '../../../features/sign-in/organisms/auth-card';

export const dynamic = 'force-dynamic';

/** pagasae did not answer, so no account signs in until it does (decision 0058); messaging goes on meanwhile. */
export default function SignInUnreachablePage() {
  return (
    <AuthCard recovery={null}>
      <div className="flex flex-col gap-4" data-testid="sign-in-unreachable">
        <div className="flex flex-col gap-1.5">
          <h1 className="text-section font-semibold">Can’t reach the sign-in service</h1>
          <p className="text-body text-muted-foreground">Nothing changed in the fleet. Try again in a moment.</p>
        </div>
        <Button variant="primary" nativeButton={false} render={<a href="/sign-in/enter">Try again</a>} data-testid="sign-in-unreachable-again">
          Try again
        </Button>
      </div>
    </AuthCard>
  );
}
