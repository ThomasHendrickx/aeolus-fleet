import { KeyRound, Lock, Tag } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { Button } from '@aeolus-fleet/ui';
import type { SealingEntry } from '../../services/sealing-entry';

interface OverviewActionsProps {
  /** labels:define: Manage labels, else View labels. */
  canDefineLabels: boolean;
  /** scopes:define: Manage scopes, else View scopes. */
  canDefineScopes: boolean;
  /** Manage sealing, View sealing, or none while the fleet's sealing flag is off (decision 0069). */
  sealing: SealingEntry;
  /** Commission, for a session that may commission. */
  commission?: ReactNode;
}

/** The Fleet overview's actions beside its title: labels, scopes, sealing while its flag is on, and Commission; stacked on a phone. */
export function OverviewActions({ canDefineLabels, canDefineScopes, sealing, commission }: OverviewActionsProps) {
  return (
    <div className="flex flex-wrap items-center gap-2 max-sm:flex-col max-sm:items-stretch">
      <Button render={<Link href="/labels" />} nativeButton={false} icon={<Tag />} data-testid="overview-labels">
        {canDefineLabels ? 'Manage labels' : 'View labels'}
      </Button>
      <Button render={<Link href="/scopes" />} nativeButton={false} icon={<KeyRound />} data-testid="overview-scopes">
        {canDefineScopes ? 'Manage scopes' : 'View scopes'}
      </Button>
      {sealing === 'off' ? null : (
        <Button render={<Link href="/sealing" />} nativeButton={false} icon={<Lock />} data-testid="overview-sealing">
          {sealing === 'manage' ? 'Manage sealing' : 'View sealing'}
        </Button>
      )}
      {commission}
    </div>
  );
}
