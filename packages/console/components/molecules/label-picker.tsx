'use client';

import type { SelectorTerm } from '@aeolus-fleet/common';
import { Boxes, ChevronLeft, ChevronRight, Search, Ship, ShipWheel } from 'lucide-react';
import { useState } from 'react';

import { classNames } from '../../lib/class-names';
import type { FilterGroup, FilterKey, OwnerMark } from '../../lib/labels';
import { Input } from '../atoms/input';

interface LabelPickerProps {
  /** Every owner's keys, yours first (canvas Labels, Q7). */
  groups: readonly FilterGroup[];
  /** The values already picked: shown as picked, not offered again. */
  pickedValueIds: readonly string[];
  onPick: (valueId: FilterKey['values'][number]['valueId']) => void;
  size?: 'sm' | 'touch';
  /** What a value already picked says: Picked in a filter, Carried on a ship. */
  pickedWord?: string;
  /** What each value's count counts: ships, or machines for a crew request's machine labels. */
  countWord?: 'ship' | 'machine';
  /** A rule's side also picks a key with any value (`*`) or the same value as the other side (`#`), offered before its values (decision 0034). */
  terms?: { picked: readonly LabelTerm[]; onPick: (term: LabelTerm) => void };
}

/** A term of a label with any value or the same value as the other side's. */
type LabelTerm = Exclude<SelectorTerm, string>;

/** The terms a key offers before its values, each with what it matches. */
const TERMS: readonly { value: LabelTerm['value']; meaning: string; testId: string }[] = [
  { value: '*', meaning: 'Any value', testId: 'label-picker-any' },
  { value: '#', meaning: 'The same value as the other side', testId: 'label-picker-same' },
];

const MARKS: Record<Exclude<OwnerMark, 'none'>, typeof Ship> = { 'trierarch-plugin': ShipWheel, squadrons: Boxes, ship: Ship };

function count(amount: number, one: string): string {
  return `${String(amount)} ${amount === 1 ? one : `${one}s`}`;
}

/**
 * Picks one label value to filter by (canvas Labels, LabelFilter): first a
 * key, found by typing, grouped by owner with "Yours" first; then one of its
 * values, each with how many ships carry it, after any value and the same
 * value when it picks for a rule's side. Back returns to the keys. Props
 * only; what it shows while picking is its own.
 */
export function LabelPicker({ groups, pickedValueIds, onPick, size = 'sm', pickedWord = 'Picked', countWord = 'ship', terms }: LabelPickerProps) {
  const [query, setQuery] = useState('');
  const [openKey, setOpenKey] = useState<FilterKey | undefined>(undefined);
  const isTouch = size === 'touch';
  const row = classNames(
    'flex w-full items-center gap-2 rounded-sm px-2 text-left hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50',
    isTouch ? 'min-h-(--size-control-touch) text-body-touch' : 'h-(--size-control-sm) text-body',
  );

  if (openKey !== undefined) {
    return (
      <div className="flex flex-col gap-1" data-testid="label-picker-values">
        <div className="flex items-center justify-between gap-2 px-1 pb-1">
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded-sm px-1 font-mono text-body hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring [&_svg]:size-(--size-icon-sm)"
            onClick={() => {
              setOpenKey(undefined);
            }}
            aria-label={`Back to the keys, from ${openKey.key}`}
          >
            <ChevronLeft aria-hidden />
            {openKey.key}=
          </button>
          <span className="text-meta text-muted-foreground">{countWord === 'ship' ? 'Ships' : 'Machines'} with each</span>
        </div>
        <ul className="flex flex-col">
          {terms === undefined
            ? null
            : TERMS.map(({ value, meaning, testId }) => {
                const isPicked = terms.picked.some((term) => term.labelId === openKey.labelId && term.value === value);
                return (
                  <li key={value}>
                    <button
                      type="button"
                      className={row}
                      disabled={isPicked}
                      data-testid={testId}
                      onClick={() => {
                        terms.onPick({ labelId: openKey.labelId, value });
                        setOpenKey(undefined);
                        setQuery('');
                      }}
                    >
                      <span className="w-3 shrink-0 font-mono">{value}</span>
                      <span className="min-w-0 grow truncate">{meaning}</span>
                      {isPicked ? <span className="shrink-0 text-meta text-muted-foreground">{pickedWord}</span> : null}
                    </button>
                  </li>
                );
              })}
          {openKey.values.map((value) => {
            const isPicked = pickedValueIds.includes(value.valueId);
            return (
              <li key={value.valueId}>
                <button
                  type="button"
                  className={row}
                  disabled={isPicked}
                  data-testid="label-picker-value"
                  onClick={() => {
                    onPick(value.valueId);
                    setOpenKey(undefined);
                    setQuery('');
                  }}
                >
                  <span className="min-w-0 grow truncate font-mono">{value.value}</span>
                  <span className="shrink-0 text-meta text-muted-foreground tabular-nums">{isPicked ? pickedWord : count(value.shipCount, countWord)}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    );
  }

  const needle = query.trim().toLowerCase();
  const shown = groups
    .map((group) => ({ ...group, keys: group.keys.filter((key) => needle === '' || key.key.includes(needle)) }))
    .filter((group) => group.keys.length > 0);
  return (
    <div className="flex flex-col gap-2" data-testid="label-picker">
      <Input
        type="search"
        aria-label="Find a key"
        placeholder="Find a key"
        size={isTouch ? 'touch' : 'md'}
        leadingIcon={<Search />}
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
        }}
      />
      {shown.length === 0 ? (
        <p className="px-2 py-3 text-meta text-muted-foreground">{groups.length === 0 ? 'The fleet has no labels yet.' : `No key matches “${query.trim()}”.`}</p>
      ) : (
        shown.map((group) => (
          <div key={group.title} className="flex flex-col">
            <span className="px-2 pt-1 pb-0.5 text-caption text-muted-foreground">{group.title}</span>
            <ul className="flex flex-col">
              {group.keys.map((key) => {
                const Mark = key.mark === 'none' ? null : MARKS[key.mark];
                return (
                  <li key={key.labelId}>
                    <button
                      type="button"
                      className={classNames(row, '[&_svg]:size-(--size-icon-sm) [&_svg]:shrink-0 [&_svg]:text-muted-foreground')}
                      data-testid="label-picker-key"
                      onClick={() => {
                        setOpenKey(key);
                      }}
                    >
                      {Mark === null ? null : <Mark aria-hidden />}
                      <span className="font-mono">{key.key}</span>
                      <span className="min-w-0 grow truncate text-meta text-muted-foreground">{count(key.values.length, 'value')}</span>
                      <ChevronRight aria-hidden />
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))
      )}
    </div>
  );
}
