import { Ellipsis, KeyRound, Lock, Tag } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { Button, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@aeolus-fleet/ui';
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

/**
 * The Fleet overview's actions beside its title (docs/design/fleet-overview):
 * one "..." menu with labels, scopes and sealing while its flag is on, then
 * Commission; the same size on a phone.
 */
export function OverviewActions({ canDefineLabels, canDefineScopes, sealing, commission }: OverviewActionsProps) {
  return (
    <div className="flex items-center gap-2 max-sm:justify-end">
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button isIconOnly aria-label="More actions" icon={<Ellipsis />} data-testid="overview-more" />} />
        <DropdownMenuContent align="end">
          <DropdownMenuItem render={<Link href="/labels" />} data-testid="overview-labels">
            <Tag aria-hidden />
            {canDefineLabels ? 'Manage labels' : 'View labels'}
          </DropdownMenuItem>
          <DropdownMenuItem render={<Link href="/scopes" />} data-testid="overview-scopes">
            <KeyRound aria-hidden />
            {canDefineScopes ? 'Manage scopes' : 'View scopes'}
          </DropdownMenuItem>
          {sealing === 'off' ? null : (
            <DropdownMenuItem render={<Link href="/sealing" />} data-testid="overview-sealing">
              <Lock aria-hidden />
              {sealing === 'manage' ? 'Manage sealing' : 'View sealing'}
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {commission}
    </div>
  );
}
