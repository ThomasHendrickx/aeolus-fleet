'use client';

import type { LabelValueId } from '@aeolus-fleet/common';
import { Check, ChevronDown, Plus, Search, Tag, Tags } from 'lucide-react';
import Link from 'next/link';
import { useState, type ReactElement } from 'react';
import dynamic from 'next/dynamic';

import type { FilterGroup, FilterKey, LabelChip as LabelChipData } from '../../../../lib/labels';
import { Button, classNames } from '@aeolus-fleet/ui';
import { Popover, PopoverContent, PopoverTrigger } from '../../../../components/atoms/popover';
import { LabelChip } from '../../../../components/molecules/label-chip';
import { FILTER_ROW, FILTER_TRIGGER } from '../molecules/type-filter';

// Loads when its popover first opens, not with the page.
const LabelPicker = dynamic(() => import('../../../../components/molecules/label-picker').then((module) => module.LabelPicker), { ssr: false });

interface LabelFilterProps {
  groups: readonly FilterGroup[];
  /** The values picked, as chips, in the order picked. */
  picked: readonly LabelChipData[];
  /** The values picked after a press, in the order picked. */
  onPickedChange: (picked: LabelValueId[]) => void;
  /** Picks one value: the phone's picker. */
  onPick: (valueId: LabelValueId) => void;
  onRemove: (valueId: LabelValueId) => void;
  onClear: () => void;
}

/** The keys whose key or any value holds the text found, each with only the values that match when the key itself does not. */
function keysFound(groups: readonly FilterGroup[], find: string): FilterKey[] {
  const needle = find.trim().toLowerCase();
  const keys = groups.flatMap((group) => group.keys);
  if (needle === '') {
    return keys;
  }
  return keys.flatMap((key) => {
    if (key.key.toLowerCase().includes(needle)) {
      return [key];
    }
    const values = key.values.filter((value) => value.value.toLowerCase().includes(needle));
    return values.length === 0 ? [] : [{ ...key, values }];
  });
}

/**
 * The label values in a popover (docs/design/fleet-overview, "Labels open"):
 * Find a label, then each key with its values under it, each with how many
 * ships carry it, checked when picked. A press picks or puts back a value;
 * it stays open while values are picked.
 */
function LabelValuesPopover({ groups, picked, onPickedChange, trigger }: Pick<LabelFilterProps, 'groups' | 'picked' | 'onPickedChange'> & { trigger: ReactElement }) {
  const [find, setFind] = useState('');
  const pickedValueIds = picked.map((chip) => chip.valueId);
  const keys = keysFound(groups, find);
  return (
    <Popover
      onOpenChange={(isOpen) => {
        if (!isOpen) {
          setFind('');
        }
      }}
    >
      <PopoverTrigger render={trigger} />
      <PopoverContent align="start" sideOffset={4} className="flex max-h-(--available-height) w-58 flex-col p-1" data-testid="fleet-filter-labels-popover">
        <label className="flex h-8.5 items-center gap-2 border-b border-border px-2 text-meta text-muted-foreground [&_svg]:size-(--size-icon-sm)">
          <Search aria-hidden />
          <input
            aria-label="Find a label"
            placeholder="Find a label"
            value={find}
            onChange={(event) => {
              setFind(event.target.value);
            }}
            className="min-w-0 flex-1 bg-transparent text-foreground outline-none placeholder:text-muted-foreground"
          />
        </label>
        <div className="flex min-h-0 flex-col overflow-y-auto pt-1">
          {keys.map((key) => (
            <div key={key.labelId} role="group" aria-label={key.key} className="flex flex-col">
              <span aria-hidden className="px-2.5 pt-2 pb-1 text-caption text-muted-foreground">
                {key.key}
              </span>
              {key.values.map(({ valueId, value, shipCount }) => {
                const isPicked = pickedValueIds.includes(valueId);
                return (
                  <button
                    key={valueId}
                    type="button"
                    aria-pressed={isPicked}
                    className={classNames(FILTER_ROW, 'relative')}
                    onClick={() => {
                      onPickedChange(isPicked ? pickedValueIds.filter((each) => each !== valueId) : [...pickedValueIds, valueId]);
                    }}
                  >
                    {isPicked ? <Check aria-hidden className="absolute left-2.5 size-(--size-icon)" /> : null}
                    <span className="min-w-0 flex-1 truncate font-mono text-meta">{value}</span>
                    <span className="text-meta text-muted-foreground tabular-nums">{shipCount}</span>
                  </button>
                );
              })}
            </div>
          ))}
          {keys.length === 0 ? (
            <p className="px-2.5 py-2 text-meta text-muted-foreground">{find.trim() === '' ? 'No labels yet.' : `No label matches “${find.trim()}”.`}</p>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/**
 * The overview's Labels filter on desktop (docs/design/fleet-overview): a
 * trigger like State's and Type's, with how many values are picked, opening
 * the values; under the bar, the values picked as "Ships with a and b",
 * each with ×, Add and Clear labels.
 */
export function LabelFilterButton({ groups, picked, onPickedChange }: Pick<LabelFilterProps, 'groups' | 'picked' | 'onPickedChange'>) {
  return (
    <LabelValuesPopover
      groups={groups}
      picked={picked}
      onPickedChange={onPickedChange}
      trigger={
        <button type="button" data-testid="fleet-filter-labels" className={FILTER_TRIGGER}>
          <Tag aria-hidden />
          <span className="font-medium">Labels</span>
          {picked.length === 0 ? null : (
            <span className="inline-flex size-5 items-center justify-center rounded-full bg-primary text-caption font-semibold text-primary-foreground tabular-nums">
              {picked.length}
              <span className="sr-only"> picked</span>
            </span>
          )}
          <ChevronDown aria-hidden className="text-muted-foreground" />
        </button>
      }
    />
  );
}

/** The values picked, under the desktop toolbar: "Ships with a and b", Add and Clear labels. None while nothing is picked. */
export function PickedLabels({ groups, picked, onPickedChange, onRemove, onClear }: Omit<LabelFilterProps, 'onPick'>) {
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
      <LabelValuesPopover
        groups={groups}
        picked={picked}
        onPickedChange={onPickedChange}
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
export function PhoneLabelFilter({ groups, picked, onPick, onRemove }: Omit<LabelFilterProps, 'onClear' | 'onPickedChange'>) {
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
