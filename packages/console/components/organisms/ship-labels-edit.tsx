'use client';

import type { LabelValueId } from '@aeolus-fleet/common';
import { Check, ChevronDown, ChevronUp, Plus, X } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';

import { classNames } from '../../lib/class-names';
import type { AssignKey, LabelChip as LabelChipData } from '../../lib/labels';
import { Button } from '../atoms/button';
import { Popover, PopoverContent, PopoverTrigger } from '../atoms/popover';
import { InlineError } from '../molecules/inline-error';
import { LabelChip } from '../molecules/label-chip';
import { LabelPicker } from '../molecules/label-picker';

interface ShipLabelsEditProps {
  /** The ship's labels as chips, yours first. */
  chips: readonly LabelChipData[];
  /** Your keys, each value with its ships and the ones this ship carries. */
  keys: readonly AssignKey[];
  /** Its count against the limit from 15 labels on, and whether it is at the limit (decision 0031). */
  limit: { count?: string; isAtLimit: boolean };
  /** A change is on its way: the menus wait. */
  isBusy?: boolean;
  /** The last change refused, with what it was and the server's words; nothing changed. */
  error?: { title: string; message: string };
  onAssign: (valueId: LabelValueId) => void;
  onUnassign: (valueId: LabelValueId) => void;
  /** Gives the chip's label another value in its place. */
  onChange: (change: { from: LabelValueId; to: LabelValueId }) => void;
}

/** How many chips show before the rest fold into "+n" (canvas Labels, LbShipFew). */
const SHOWN = 2;

/** Your chip, as a menu: the label's other values to change to, and Remove label (canvas LbShipChange). */
function YourChip({ chip, labelKey, isBusy, onUnassign, onChange }: { chip: LabelChipData; labelKey: AssignKey | undefined } & Pick<ShipLabelsEditProps, 'isBusy' | 'onUnassign' | 'onChange'>) {
  const [isOpen, setIsOpen] = useState(false);
  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger
        render={
          <button
            type="button"
            aria-label={`Change or remove ${chip.key}=${chip.value}`}
            data-testid="ship-label-yours"
            disabled={isBusy}
            className="inline-flex items-center rounded-sm focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-60"
          />
        }
      >
        <LabelChip chip={chip} trailing={<ChevronDown aria-hidden />} className="hover:bg-accent" />
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={6} className="w-72 p-1.5" data-testid="ship-label-menu">
        <span className="flex items-center justify-between px-2 pt-1 pb-1.5 text-meta">
          <span className="font-mono">
            {chip.key}=<span className="text-muted-foreground">{chip.value}</span>
          </span>
          <span className="text-muted-foreground">Change the value</span>
        </span>
        <ul className="flex flex-col">
          {(labelKey?.values ?? []).map((value) => {
            const isThis = value.valueId === chip.valueId;
            const isCarried = labelKey?.carriedValueIds.includes(value.valueId) ?? false;
            return (
              <li key={value.valueId}>
                <button
                  type="button"
                  disabled={isCarried}
                  data-testid="ship-label-value"
                  className="flex h-(--size-control-sm) w-full items-center gap-2 rounded-sm px-2 text-left text-body hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring disabled:pointer-events-none [&_svg]:size-(--size-icon-sm)"
                  onClick={() => {
                    setIsOpen(false);
                    onChange({ from: chip.valueId, to: value.valueId });
                  }}
                >
                  <span className="w-4">{isCarried ? <Check aria-hidden /> : null}</span>
                  <span className={classNames('min-w-0 grow truncate font-mono', isCarried && !isThis ? 'text-muted-foreground' : undefined)}>{value.value}</span>
                  <span className="text-meta text-muted-foreground tabular-nums">
                    {isCarried && !isThis ? 'Carried' : `${String(value.shipCount)} ${value.shipCount === 1 ? 'ship' : 'ships'}`}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        <div className="mt-1 border-t border-border pt-1">
          <button
            type="button"
            data-testid="ship-label-remove"
            className="flex h-(--size-control-sm) w-full items-center gap-2 rounded-sm px-2 text-body text-destructive-text hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring [&_svg]:size-(--size-icon-sm)"
            onClick={() => {
              setIsOpen(false);
              onUnassign(chip.valueId);
            }}
          >
            <X aria-hidden />
            Remove label
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** Add label: one of your keys, then a value (canvas LbShipAddKey, LbShipAddValue); a carried key takes another value beside it (#102, point 13). */
function AddLabel({ keys, isBusy, onAssign }: Pick<ShipLabelsEditProps, 'keys' | 'isBusy' | 'onAssign'>) {
  const [isOpen, setIsOpen] = useState(false);
  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger render={<Button variant="ghost" size="xs" icon={<Plus />} disabled={isBusy} data-testid="ship-labels-add" />}>Add label</PopoverTrigger>
      <PopoverContent align="start" sideOffset={6} className="w-80 p-2" data-testid="ship-labels-add-popover">
        <span className="flex items-center justify-between px-2 pt-1 pb-2 text-body font-medium">
          Add a label
          <span className="text-meta font-normal text-muted-foreground">Yours</span>
        </span>
        {keys.length === 0 ? (
          <p className="px-2 py-2 text-meta text-muted-foreground">You have no labels yet. Define one on the Labels page, then put it on ships here.</p>
        ) : (
          <LabelPicker
            groups={[{ title: 'Yours', keys: [...keys] }]}
            pickedValueIds={keys.flatMap((key) => key.carriedValueIds)}
            pickedWord="Carried"
            onPick={(valueId) => {
              setIsOpen(false);
              onAssign(valueId);
            }}
          />
        )}
        <p className="mt-2 flex items-center justify-between border-t border-border px-2 pt-2 text-meta">
          <Link href="/labels" className="font-medium hover:underline">
            {keys.length === 0 ? 'Define a label' : 'Manage labels'}
          </Link>
        </p>
      </PopoverContent>
    </Popover>
  );
}

/**
 * A ship's labels on its page, with yours to change (canvas Labels, LbShipFew,
 * LbShipExpanded, LbShipChange, LbShipAddKey, LbShipAddValue, LbShipLimit,
 * LbShipRefused; Q12): yours first, each a menu to change its value or remove
 * it; others' read-only after "by <owner>"; Add label for one of yours. From
 * 15 labels the count shows; at 20 Add label goes and the limit is named. A
 * refusal says what and why; nothing changed.
 */
export function ShipLabelsEdit({ chips, keys, limit, isBusy, error, onAssign, onUnassign, onChange }: ShipLabelsEditProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const isFolded = !isExpanded && chips.length > SHOWN + 1;
  const shown = isFolded ? chips.slice(0, SHOWN) : chips;
  const owners = [...new Set(shown.filter((chip) => chip.mark !== 'none').map((chip) => chip.ownerName))];

  return (
    <span className="flex min-w-0 flex-col gap-2" data-testid="ship-labels-edit">
      <span className="flex min-w-0 flex-wrap items-center gap-1.5">
        {chips.length === 0 ? <span className="text-meta text-muted-foreground">No labels</span> : null}
        {shown
          .filter((chip) => chip.mark === 'none')
          .map((chip) => (
            <YourChip key={chip.valueId} chip={chip} labelKey={keys.find((key) => key.labelId === chip.labelId)} isBusy={isBusy} onUnassign={onUnassign} onChange={onChange} />
          ))}
        {isFolded ? (
          <button
            type="button"
            aria-label={`Show all ${String(chips.length)} labels`}
            data-testid="ship-labels-more"
            className="inline-flex h-5.5 items-center rounded-sm bg-secondary px-1.5 text-caption font-medium tabular-nums hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring"
            onClick={() => {
              setIsExpanded(true);
            }}
          >
            +{chips.length - SHOWN}
          </button>
        ) : null}
        {limit.isAtLimit ? null : <AddLabel keys={keys} isBusy={isBusy} onAssign={onAssign} />}
        {owners.map((owner) => (
          <span key={owner} className="inline-flex flex-wrap items-center gap-1.5">
            <span className="text-meta text-muted-foreground">by {owner}</span>
            {shown
              .filter((chip) => chip.mark !== 'none' && chip.ownerName === owner)
              .map((chip) => (
                <LabelChip key={chip.valueId} chip={chip} testId="ship-label" />
              ))}
          </span>
        ))}
        {isExpanded && chips.length > SHOWN + 1 ? (
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded-sm px-1 text-meta hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring [&_svg]:size-(--size-icon-sm)"
            onClick={() => {
              setIsExpanded(false);
            }}
          >
            <ChevronUp aria-hidden />
            Show fewer
          </button>
        ) : null}
        {limit.isAtLimit ? <span className="text-meta text-muted-foreground">At the limit: a ship carries at most 20 labels (decision 0031).</span> : null}
        {limit.count === undefined ? null : (
          <span className="ml-auto text-meta text-muted-foreground tabular-nums" data-testid="ship-labels-count">
            {limit.count}
          </span>
        )}
      </span>
      {error === undefined ? null : <InlineError title={error.title} description={`Refused: ${error.message}. Nothing changed.`} />}
    </span>
  );
}
