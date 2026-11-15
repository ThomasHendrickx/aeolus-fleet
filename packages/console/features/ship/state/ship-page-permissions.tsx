'use client';

import type { ShipDetail } from '@aeolus-fleet/common';
import { showToast } from '@aeolus-fleet/ui';
import { useState } from 'react';

import { useShipPermissions } from '../hooks/use-ship-permissions';
import { ShipPermissions } from '../ui/organisms/ship-permissions';

/** A successful save closes the editor with the new held permissions; a refusal preserves the edits. */
export function ShipPagePermissions({ ship }: { ship: ShipDetail }) {
  const { choices, canChange, change, catalogue } = useShipPermissions(ship);
  const [savedVersion, setSavedVersion] = useState(0);
  return <ShipPermissions key={savedVersion} shipName={ship.name} scopes={ship.scopes} choices={choices} canChange={canChange} isPending={change.isPending} error={change.error?.message} readError={catalogue.error?.message} onRetry={() => { void catalogue.refetch(); }} onSave={(difference) => {
    change.mutate({ shipId: ship.id, ...difference }, { onSuccess: () => {
      setSavedVersion((version) => version + 1);
      showToast({ title: `Permissions saved for ${ship.name}`, tone: 'success' });
    } });
  }} />;
}
