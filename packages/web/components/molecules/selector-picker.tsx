'use client';

import type { ListedShip, ShipId } from '@aeolus-fleet/common';
import { CircleAlert, Search, Tag } from 'lucide-react';
import { useId } from 'react';

import { locationKindWord } from '../../lib/location';
import { counted } from '../../lib/sentence';
import { asHandle } from '../../lib/ship-name';
import { Combobox, type ComboboxOption } from '../atoms/combobox';
import { Label } from '../atoms/label';
import { Tabs, TabsList, TabsTrigger } from '../atoms/tabs';
import { StatusBadge } from './status-badge';

/** Who a message goes to: one ship, or any ship of a type. */
export type SelectorValue = { kind: 'ship'; shipId: ShipId } | { kind: 'type'; type: string };
const MODES = ['ship', 'type'] as const;
export type SelectorMode = (typeof MODES)[number];

interface SelectorPickerProps {
  mode: SelectorMode;
  onModeChange: (mode: SelectorMode) => void;
  /** The chosen ship (ship mode) or the typed type (type mode); null while empty. */
  value: SelectorValue | null;
  onChange: (value: SelectorValue | null) => void;
  /** Ships the operator may pick: the caller passes active ships, never argo, never retired. */
  ships: readonly ListedShip[];
  /** Type suggestions: the types of active ships. */
  types: readonly string[];
  error?: string;
}

function shipOption(ship: ListedShip): ComboboxOption {
  const { location } = ship;
  const where = location === null ? null : (location.description ?? locationKindWord(location.kind));
  return {
    value: ship.id,
    label: ship.name,
    detail: where === null ? ship.type : `${ship.type} · ${where}`,
    trailing: <StatusBadge status={ship.status} />,
  };
}

const SHIPS = { one: 'ship', many: 'ships' };

function shipsOfType(ships: readonly ListedShip[], type: string): number {
  return ships.filter((ship) => ship.type === type).length;
}

/**
 * Chooses who a message goes to (docs/design/png/SelectorPicker.png): one
 * ship by name, or any ship of a type. Ship mode searches the ships it is
 * given, which the caller keeps to active ships other than argo. Type mode is
 * free text with the types in use as suggestions; an unknown type is refused
 * by the server, not guessed here. The hint under the field says what the
 * choice means: a ship without crew keeps the message in its inbox; a type
 * is a queue any of its ships claims from.
 */
export function SelectorPicker({ mode, onModeChange, value, onChange, ships, types, error }: SelectorPickerProps) {
  const fieldId = useId();
  const hintId = useId();
  const typed = value?.kind === 'type' ? value.type : null;
  const users = typed === null ? 0 : shipsOfType(ships, typed);

  return (
    <div data-slot="selector-picker" className="flex flex-col gap-1.5">
      <Label htmlFor={fieldId}>To</Label>
      <Tabs
        value={mode}
        onValueChange={(next: unknown) => {
          const chosen = MODES.find((each) => each === next);
          if (chosen !== undefined) {
            onModeChange(chosen);
          }
        }}
      >
        <TabsList aria-label="Send to" className="w-full">
          <TabsTrigger value="ship" data-testid="compose-mode-ship" className="grow">
            A specific ship
          </TabsTrigger>
          <TabsTrigger value="type" data-testid="compose-mode-type" className="grow">
            Any ship of a type
          </TabsTrigger>
        </TabsList>
      </Tabs>
      {mode === 'ship' ? (
        <Combobox
          key="ship"
          id={fieldId}
          options={ships.map(shipOption)}
          value={value?.kind === 'ship' ? value.shipId : null}
          onValueChange={(shipId) => {
            const ship = ships.find((each) => each.id === shipId);
            onChange(ship ? { kind: 'ship', shipId: ship.id } : null);
          }}
          toQuery={asHandle}
          groupLabel="Ships"
          emptyText={(query) => `No ship matches "${query}". Retired ships are not listed.`}
          leadingIcon={<Search />}
          placeholder="Choose a ship"
          isInvalid={error !== undefined}
          aria-describedby={hintId}
          data-testid="compose-ship"
        />
      ) : (
        <Combobox
          key="type"
          id={fieldId}
          options={types.map((type) => ({
            value: type,
            label: type,
            trailing: (
              <span className="text-meta text-muted-foreground tabular-nums">
                {counted(shipsOfType(ships, type), SHIPS)}
              </span>
            ),
          }))}
          value={typed}
          onValueChange={(type) => {
            onChange(type === null || type.trim() === '' ? null : { kind: 'type', type: type.trim() });
          }}
          isFreeText
          toQuery={asHandle}
          leadingIcon={<Tag />}
          placeholder="Type"
          isInvalid={error !== undefined}
          aria-describedby={hintId}
          data-testid="compose-type"
        />
      )}
      {error === undefined ? (
        <p id={hintId} className="text-meta text-muted-foreground">
          {mode === 'ship'
            ? 'If the ship has no crew right now, the message waits in its inbox.'
            : `Goes to a queue any ship of this type can claim from.${
                typed === null ? '' : ` ${counted(users, SHIPS)} ${users === 1 ? 'uses' : 'use'} this type.`
              }`}
        </p>
      ) : (
        <p id={hintId} role="alert" className="flex items-center gap-1.5 text-meta text-destructive [&_svg]:size-(--size-icon-sm)">
          <CircleAlert aria-hidden />
          {error}
        </p>
      )}
    </div>
  );
}
