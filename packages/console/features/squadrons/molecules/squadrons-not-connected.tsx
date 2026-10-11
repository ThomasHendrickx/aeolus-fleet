import { Unplug } from 'lucide-react';
import Link from 'next/link';

import { Button } from '../../../components/atoms/button';
import { EmptyState } from '../../../components/molecules/empty-state';

/**
 * A squadrons page while squadrons is configured but not connected: a normal
 * state, not an error. Nothing is asked of squadrons until Settings connects it.
 */
export function SquadronsNotConnected() {
  return (
    <EmptyState
      icon={<Unplug aria-hidden />}
      title="Squadrons is not connected"
      description="Connect it in Settings; squadrons, blueprints and templates show up here then."
      action={
        <Button nativeButton={false} render={<Link href="/settings" />} data-testid="squadrons-open-settings">
          Open Settings
        </Button>
      }
    />
  );
}
