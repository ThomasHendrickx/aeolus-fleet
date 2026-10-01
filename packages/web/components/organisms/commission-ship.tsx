'use client';

import { Plus } from 'lucide-react';
import { useState } from 'react';

import { useCommissionShip, useFleetSnapshot } from '../../lib/fleet';
import { Button } from '../atoms/button';
import { CommissionDialog } from './commission-dialog';
import { StartingPromptDialog } from './starting-prompt-dialog';

/**
 * Commission ship, the fleet overview's one primary action: the
 * CommissionDialog, then, once the ship exists, its first starting prompt in
 * the StartingPromptDialog, shown once. The page or the command palette may
 * open it too, through `isOpen`.
 */
export function CommissionShip({ isOpen, onOpenChange }: { isOpen: boolean; onOpenChange: (isOpen: boolean) => void }) {
  const fleet = useFleetSnapshot();
  const commission = useCommissionShip();
  const [isPromptOpen, setIsPromptOpen] = useState(false);
  const activeShips = (fleet.data ?? []).filter((ship) => ship.status !== 'retired');

  return (
    <>
      <Button
        variant="primary"
        icon={<Plus />}
        data-testid="fleet-commission"
        onClick={() => {
          commission.reset();
          onOpenChange(true);
        }}
      >
        Commission ship
      </Button>
      <CommissionDialog
        activeShips={activeShips}
        isOpen={isOpen}
        onOpenChange={onOpenChange}
        isPending={commission.isPending}
        error={commission.error?.message}
        onSubmit={(ship) => {
          commission.mutate(ship, {
            onSuccess: () => {
              onOpenChange(false);
              setIsPromptOpen(true);
            },
          });
        }}
      />
      <StartingPromptDialog
        shipName={commission.variables?.name ?? ''}
        state="shown"
        prompt={commission.data?.prompt}
        crewLine={commission.data?.crewLine}
        isOpen={isPromptOpen && commission.data !== undefined}
        onOpenChange={(isNowOpen) => {
          if (!isNowOpen) {
            setIsPromptOpen(false);
            commission.reset();
          }
        }}
        onConfirm={() => undefined}
      />
    </>
  );
}
