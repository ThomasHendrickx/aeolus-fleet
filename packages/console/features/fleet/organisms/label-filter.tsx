'use client';

import type { LabelValueId } from '@aeolus-fleet/common';
import { ChevronDown, Plus, Tag, Tags } from 'lucide-react';
import Link from 'next/link';
import { useState, type ReactElement } from 'react';
import dynamic from 'next/dynamic';

import type { FilterGroup, LabelChip as LabelChipData } from '../../../lib/labels';
import { Button } from '../../../components/atoms/button';
import { Popover, PopoverContent, PopoverTrigger } from '../../../components/atoms/popover';
import { LabelChip } from '../../../components/molecules/label-chip';

// Loads when its popover first opens, not with the page.
const LabelPicker = dynamic(() => import('../../../components/molecules/label-picker').then((module) => module.LabelPicker), { ssr: false });

interface LabelFilterProps {
  groups: readonly FilterGroup[];
  /** The values picked, as chips, in the order picked. */
  picked: readonly LabelChipData[];
  onPick: (valueId: LabelValueId) => void;
  onRemove: (valueId: LabelValueId) => void;
  onClear: () => void;
}

/** The picker in its popover, with the rule under it. */
function PickerPopover({ groups, picked, onPick, trigger }: Pick<LabelFilterProps, 'groups' | 'picked' | 'onPick'> & { trigger: ReactElement }) {
  const [isOpen, setIsOpen] = useState(false);
  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger render={trigger} />
      <PopoverContent align="start" sideOffset={6} className="w-80 p-2" data-testid="label-filter-popover">
        <span className="block px-2 pt-1 pb-2 text-body font-medium">Filter by label</span>
        <LabelPicker
          groups={groups}
          pickedValueIds={picked.map((chip) => chip.valueId)}
          onPick={(valueId) => {
            onPick(valueId);
            setIsOpen(false);
          }}
        />
        <p className="mt-2 flex items-center justify-between gap-2 border-t border-border px-2 pt-2 text-meta text-muted-foreground">
          Exact matches, all must hold.
          <Link href="/labels" className="font-medium text-foreground hover:underline" data-testid="label-filter-manage">
            Manage labels
          </Link>
        </p>
      </PopoverContent>
    </Popover>
  );
}

/**
 * The overview's label filter on desktop (canvas Labels, LbOverviewKey,
 * LbOverviewValue, LbOverviewFiltered; Q7): a Labels button with how many
 * values are picked, opening the picker; under the toolbar, the values picked
 * as "Ships with a and b", each with ×, Add and Clear labels.
 */
export function LabelFilterButton({ groups, picked, onPick }: Pick<LabelFilterProps, 'groups' | 'picked' | 'onPick'>) {
  return (
    <PickerPopover
      groups={groups}
      picked={picked}
      onPick={onPick}
      trigger={
        <Button variant="secondary" size="sm" icon={<Tag />} data-testid="fleet-filter-labels">
          Labels
          {picked.length === 0 ? null : (
            <span className="inline-flex size-5 items-center justify-center rounded-full bg-primary text-caption font-semibold text-primary-foreground tabular-nums">
              {picked.length}
              <span className="sr-only"> picked</span>
            </span>
          )}
          <ChevronDown aria-hidden className="text-muted-foreground" />
        </Button>
      }
    />
  );
}

/** The values picked, under the desktop toolbar: "Ships with a and b", Add and Clear labels. None while nothing is picked. */
export function PickedLabels({ groups, picked, onPick, onRemove, onClear }: LabelFilterProps) {
  if (picked.length === 0) {
    return null;
  }
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 text-meta max-sm:hidden" data-testid="fleet-picked-labels">
      <span className="text-muted-foreground">Ships with</span>
      {picked.map((chip, index) => (
        <span key={chip.valueId} className="inline-flex items-center gap-2">
          {index === 0 ? null : <span className="text-muted-foreground">and</span>}
          <LabelChip
            chip={chip}
            testId="fleet-picked-label"
            onRemove={() => {
              onRemove(chip.valueId);
            }}
          />
        </span>
      ))}
      <PickerPopover
        groups={groups}
        picked={picked}
        onPick={onPick}
        trigger={
          <Button variant="ghost" size="xs" icon={<Plus />}>
            Add
          </Button>
        }
      />
      <span aria-hidden className="h-4 w-px bg-border" />
      <Button variant="ghost" size="xs" onClick={onClear} data-testid="fleet-labels-clear">
        Clear labels
      </Button>
    </div>
  );
}

/**
 * The label part of the phone's filters Sheet (canvas Labels, LbMFilters):
 * the values picked, each with ×, joined by "and", and Add label, which opens
 * the picker in place.
 */
export function PhoneLabelFilter({ groups, picked, onPick, onRemove }: Omit<LabelFilterProps, 'onClear'>) {
  const [isPicking, setIsPicking] = useState(false);
  return (
    <div className="flex flex-col gap-2" data-testid="fleet-filter-labels-touch">
      <span className="flex items-center gap-2 text-meta font-medium text-muted-foreground">
        Labels <span className="font-normal">all must hold</span>
      </span>
      {picked.length === 0 ? null : (
        <div className="flex flex-wrap items-center gap-2 text-meta">
          {picked.map((chip, index) => (
            <span key={chip.valueId} className="inline-flex items-center gap-2">
              {index === 0 ? null : <span className="text-muted-foreground">and</span>}
              <LabelChip
                chip={chip}
                onRemove={() => {
                  onRemove(chip.valueId);
                }}
              />
            </span>
          ))}
        </div>
      )}
      {isPicking ? (
        <div className="rounded-lg border border-border p-2">
          <LabelPicker
            groups={groups}
            pickedValueIds={picked.map((chip) => chip.valueId)}
            size="touch"
            onPick={(valueId) => {
              onPick(valueId);
              setIsPicking(false);
            }}
          />
        </div>
      ) : (
        <Button
          variant="secondary"
          size="touch"
          icon={<Plus />}
          className="self-start"
          onClick={() => {
            setIsPicking(true);
          }}
        >
          Add label
        </Button>
      )}
      <Link href="/labels" className="inline-flex items-center gap-1.5 self-start text-meta text-muted-foreground hover:underline [&_svg]:size-(--size-icon-sm)">
        <Tags aria-hidden />
        All labels and their owners
      </Link>
    </div>
  );
}
