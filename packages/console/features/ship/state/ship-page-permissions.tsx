'use client';

import type { ShipDetail } from '@aeolus-fleet/common';

import { useShipPermissions } from '../hooks/use-ship-permissions';
import { ShipPermissions } from '../ui/organisms/ship-permissions';

/** Connects one ship's permission port to its inline editor. */
export function ShipPagePermissions({ ship }: { ship: ShipDetail }) {
  const { savedVersion, ...permissions } = useShipPermissions(ship);
  return <ShipPermissions key={savedVersion} shipName={ship.name} scopes={ship.scopes} {...permissions} />;
}
