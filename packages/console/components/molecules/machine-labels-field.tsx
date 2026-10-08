'use client';

import { SHIP_LABELS_MAX } from '@aeolus-fleet/common';
import { CircleAlert, Clock, Plus, X } from 'lucide-react';
import Link from 'next/link';
import { Fragment, useState } from 'react';

import type { FilterGroup, LabelChip as LabelChipData } from '../../lib/labels';
import { noMatchWords, type MachineMatch } from '../../lib/machine-labels';
import { Button } from '../atoms/button';
import { Popover, PopoverContent, PopoverTrigger } from '../atoms/popover';
import { LabelChip } from './label-chip';
import { LabelPicker } from './label-picker';

interface MachineLabelsFieldProps {
  shipName: string;
  /** The values picked, as chips, in the order picked. */
  picked: readonly LabelChipData[];
  /** Every key, those on machines first, each value with how many machines carry it. */
  groups: readonly FilterGroup[];
  /** Which machines carry every value picked. */
  match: MachineMatch;
  isDisabled?: boolean;
  onAdd: (valueId: string) => void;
  onRemove: (valueId: string) => void;
  /** Labels a squadron file names that the fleet does not have, as `key=value`: shown as warnings, removable (#343). */
  unknown?: readonly string[];
  onRemoveUnknown?: (name: string) => void;
}

/** Add label: a key, then one of its values (canvas LbRequestPicking). */
function AddMachineLabel({ groups, picked, isDisabled, onAdd }: Pick<MachineLabelsFieldProps, 'groups' | 'picked' | 'isDisabled' | 'onAdd'>) {
  const [isOpen, setIsOpen] = useState(false);
  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger render={<Button type="button" variant="ghost" size="xs" icon={<Plus />} disabled={isDisabled} data-testid="machine-labels-add" />}>Add label</PopoverTrigger>
      <PopoverContent align="start" sideOffset={6} className="w-80 p-2" data-testid="machine-labels-popover">
        <span className="block px-2 pt-1 pb-2 text-body font-medium">Machine label</span>
        <LabelPicker
          groups={groups}
          pickedValueIds={picked.map((chip) => chip.valueId)}
          countWord="machine"
          onPick={(valueId) => {
            setIsOpen(false);
            onAdd(valueId);
          }}
        />
        <p className="mt-2 flex items-center justify-between gap-2 border-t border-border px-2 pt-2 text-meta text-muted-foreground">
          Exact matches, all must hold.
          <Link href="/labels" className="font-medium text-foreground hover:underline">
            Manage labels
          </Link>
        </p>
      </PopoverContent>
    </Popover>
  );
}

/**
 * A crew request's machine labels (canvas Labels, LbRequest, LbRequestPicking,
 * LbRequestTwo, LbRequestNoMatch; #102): empty for any machine; each value
 * picked a chip with ×, joined by "and", then Add label. Under it, which
 * machines carry them all; when none does, the request may still be made and
 * waits on Needs crew. At most 20, as a ship carries.
 */
export function MachineLabelsField({ shipName, picked, groups, match, isDisabled, onAdd, onRemove, unknown = [], onRemoveUnknown }: MachineLabelsFieldProps) {
  const words = noMatchWords(picked.length);
  return (
    <div className="flex flex-col gap-1.5" data-testid="machine-labels">
      <span className="text-body font-medium">
        Machine labels<span className="font-normal text-muted-foreground"> optional</span>
      </span>
      <div className="flex min-h-(--size-control-sm) flex-wrap items-center gap-1.5">
        {picked.length === 0 ? <span className="text-meta text-muted-foreground">Any machine</span> : null}
        {picked.map((chip, index) => (
          <Fragment key={chip.valueId}>
            {index === 0 ? null : <span className="text-meta text-muted-foreground">and</span>}
            <LabelChip
              chip={chip}
              testId="machine-label"
              {...(isDisabled
                ? {}
                : {
                    onRemove: () => {
                      onRemove(chip.valueId);
                    },
                  })}
            />
          </Fragment>
        ))}
        {unknown.map((name) => (
          <span
            key={name}
            data-testid="machine-label-unknown"
            title={`${name}: not in this fleet`}
            className="inline-flex h-5.5 items-center gap-1 rounded-sm border border-tone-attention-border bg-tone-attention-bg px-1.5 font-mono text-id text-tone-attention-fg [&_svg]:size-3"
          >
            <CircleAlert aria-hidden />
            {name}
            {onRemoveUnknown === undefined || isDisabled ? null : (
              <button
                type="button"
                aria-label={`Remove ${name}`}
                onClick={() => {
                  onRemoveUnknown(name);
                }}
                className="-mr-1 ml-0.5 inline-flex size-4 items-center justify-center rounded-xs hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring"
              >
                <X aria-hidden />
              </button>
            )}
          </span>
        ))}
        {picked.length + unknown.length >= SHIP_LABELS_MAX ? null : <AddMachineLabel groups={groups} picked={picked} isDisabled={isDisabled} onAdd={onAdd} />}
      </div>
      {unknown.length === 0 ? null : (
        <p role="alert" data-testid="machine-labels-unknown-note" className="text-meta text-tone-attention-fg">
          Not in this fleet: {unknown.join(', ')}. Forming refuses {unknown.length === 1 ? 'it' : 'them'}: define {unknown.length === 1 ? 'it' : 'them'} on the Labels page, or remove {unknown.length === 1 ? 'it' : 'them'} here.
        </p>
      )}
      {picked.length === 0 ? null : match.matching.length === 0 ? (
        <p
          role="status"
          data-testid="machine-labels-match"
          className="flex items-start gap-2 rounded-lg border border-tone-waiting-border bg-tone-waiting-bg px-3 py-2 text-meta text-tone-waiting-fg [&_svg]:mt-0.5 [&_svg]:size-(--size-icon-sm) [&_svg]:shrink-0"
        >
          <Clock aria-hidden />
          <span>
            No machine matches {words.these}. You can still request: it waits on Needs crew until a machine {words.carries}.
          </span>
        </p>
      ) : (
        <p className="text-meta" data-testid="machine-labels-match">
          Matches {match.matching.length} of {match.total} {match.total === 1 ? 'machine' : 'machines'}: {match.matching.join(', ')}.
        </p>
      )}
      <p className="text-meta text-muted-foreground">The plugin places {shipName} only on a machine that carries every label here. Leave it empty for any machine.</p>
    </div>
  );
}
