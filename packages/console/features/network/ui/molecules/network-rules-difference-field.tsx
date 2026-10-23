'use client';

import type { DifferenceWay, NetworkRulesDifference, ShipId } from '@aeolus-fleet/common';

import { Combobox } from '../../../../components/atoms/combobox';
import { RadioGroup, RadioGroupItem } from '../../../../components/atoms/radio-group';
import { differenceKeyOf, waysOf, type ResolutionChoice } from '../../services/rules-file';

export interface NetworkRulesDifferenceFieldProps {
  difference: NetworkRulesDifference;
  /** The way picked, with its ship for a pick; none until the person picks. */
  choice?: ResolutionChoice;
  /** The active ships a pick may name. */
  ships: readonly { id: ShipId; name: string }[];
  isDisabled: boolean;
  onChange: (choice: ResolutionChoice) => void;
}

function headlineOf(difference: NetworkRulesDifference): string {
  switch (difference.kind) {
    case 'definer':
      return `${difference.key} is defined by ${difference.fleetDefiner} here, by ${difference.fileDefiner} in the file`;
    case 'values':
      return `${difference.key} has ${difference.fleetValues.join(', ')} here; the file gives ${difference.fileValues.join(', ')}`;
    case 'ship':
      return `No active ship is named ${difference.name}`;
  }
}

/**
 * One difference between a network rules file and the fleet (design
 * network-io, Q9), with the ways it offers to resolve it as a radio group,
 * and the ship to name for a pick. Props only.
 */
export function NetworkRulesDifferenceField({ difference, choice, ships, isDisabled, onChange }: NetworkRulesDifferenceFieldProps) {
  const key = differenceKeyOf(difference);
  const id = `network-import-difference-${key.replace(':', '-')}`;
  return (
    <fieldset className="flex flex-col gap-2 rounded-lg border border-border bg-card p-3" data-testid="network-import-difference">
      <legend className="sr-only">{headlineOf(difference)}</legend>
      <p className="text-body font-medium" aria-hidden>
        {headlineOf(difference)}
      </p>
      <RadioGroup<DifferenceWay>
        value={choice?.way}
        disabled={isDisabled}
        onValueChange={(way) => {
          onChange({ difference, way });
        }}
      >
        {waysOf(difference).map(({ way, text }) => (
          <div key={way} className="flex items-start gap-2">
            <RadioGroupItem id={`${id}-${way}`} value={way} className="mt-0.5" data-testid={`network-import-way-${way}`} />
            <label htmlFor={`${id}-${way}`} className="min-w-0 grow cursor-pointer text-body">
              {text}
            </label>
          </div>
        ))}
      </RadioGroup>
      {choice?.way === 'pickShip' ? (
        <Combobox
          options={ships.map((ship) => ({ value: ship.id, label: ship.name }))}
          value={choice.shipId ?? null}
          onValueChange={(shipId) => {
            const picked = ships.find((ship) => ship.id === shipId);
            onChange({ difference, way: 'pickShip', ...(picked === undefined ? {} : { shipId: picked.id }) });
          }}
          groupLabel="Active ships"
          placeholder="Type a ship name"
          aria-label={`The ship for ${difference.kind === 'ship' ? difference.name : ''}`}
          data-testid="network-import-pick-ship"
        />
      ) : null}
    </fieldset>
  );
}
