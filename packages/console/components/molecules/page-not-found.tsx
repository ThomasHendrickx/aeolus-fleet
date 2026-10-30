import Link from 'next/link';

import { Button } from '@aeolus-fleet/common/header';
import { EmptyState } from './empty-state';

/**
 * The console's Not found, inside the ConsoleFrame (feature flags console
 * mockup): what a console address with nothing at it shows, such as
 * /sealing while the fleet's sealing flag is off (decision 0069).
 */
export function PageNotFound() {
  return (
    <EmptyState
      title="Page not found"
      description="There is nothing at this address in your fleet."
      action={
        <Button size="sm" render={<Link href="/" />} nativeButton={false} data-testid="not-found-overview">
          Back to the fleet overview
        </Button>
      }
    />
  );
}
