'use client';

import type { ShipDetail } from '@aeolus-fleet/common';
import { useState } from 'react';

import { useConsoleConstants } from '../../lib/console-constants';
import { useAccess } from '../../lib/access';
import { useAssignLabel, useLabelContext, useUnassignLabel } from '../../lib/fleet';
import { assignKeysOf, chipsOf, labelLimitOf } from '../../lib/labels';
import { Skeleton } from '../atoms/skeleton';
import { ShipLabels } from '../molecules/ship-labels';
import { ShipLabelsEdit } from './ship-labels-edit';

/** The words a value goes by: "key=value", from your keys. */
function textOf(keys: ReturnType<typeof assignKeysOf>, valueId: string): string {
  for (const key of keys) {
    const value = key.values.find((each) => each.valueId === valueId);
    if (value !== undefined) {
      return `${key.key}=${value.value}`;
    }
  }
  return 'the label';
}

/**
 * A ship's labels on its page (#102): with labels:assign, yours to put on,
 * change or take off, on any ship but argo itself and a retired one (no ship
 * labels itself, decision 0031); read-only otherwise. Each change applies at
 * once; a refusal says why and nothing changes.
 */
export function ShipPageLabels({ ship }: { ship: ShipDetail }) {
  const { shipLabelsMax } = useConsoleConstants();
  const context = useLabelContext();
  const access = useAccess();
  const assign = useAssignLabel();
  const unassign = useUnassignLabel();
  const [error, setError] = useState<{ title: string; message: string } | undefined>(undefined);

  if (context === undefined) {
    return <Skeleton className="h-5.5 w-40" />;
  }
  const chips = chipsOf(ship, context);
  const canAssign = access.canAssignLabels && ship.kind !== 'operator' && ship.status !== 'retired';
  if (!canAssign) {
    return <ShipLabels chips={chips} />;
  }
  const keys = assignKeysOf(ship, context);
  const refused = (title: string) => (failure: { message: string }) => {
    setError({ title, message: failure.message });
  };

  return (
    <ShipLabelsEdit
      chips={chips}
      keys={keys}
      limit={labelLimitOf(ship, shipLabelsMax)}
      isBusy={assign.isPending || unassign.isPending}
      error={error}
      onAssign={(valueId) => {
        setError(undefined);
        assign.mutate({ shipId: ship.id, valueId }, { onError: refused(`Couldn’t add ${textOf(keys, valueId)}`) });
      }}
      onUnassign={(valueId) => {
        setError(undefined);
        unassign.mutate({ shipId: ship.id, valueId }, { onError: refused(`Couldn’t remove ${textOf(keys, valueId)}`) });
      }}
      onChange={({ from, to }) => {
        setError(undefined);
        const was = from;
        // Off first, so a ship at the limit can change a value; if the new one is refused, the old one goes back.
        unassign.mutate(
          { shipId: ship.id, valueId: was },
          {
            onSuccess: () => {
              assign.mutate(
                { shipId: ship.id, valueId: to },
                {
                  onError: (failure) => {
                    assign.mutate({ shipId: ship.id, valueId: was });
                    refused(`Couldn’t change ${textOf(keys, from)} to ${textOf(keys, to)}`)(failure);
                  },
                },
              );
            },
            onError: refused(`Couldn’t change ${textOf(keys, from)}`),
          },
        );
      }}
    />
  );
}
