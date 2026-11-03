'use client';

import { Check, ChevronDown, Search } from 'lucide-react';
import { useState } from 'react';

import { classNames } from '@aeolus-fleet/ui';
import { Popover, PopoverContent, PopoverTrigger } from '../../../../components/atoms/popover';

export interface TypeFilterProps {
  /** The fleet's types, each with how many ships carry it, sorted. */
  types: readonly { type: string; ships: number }[];
  /** How many ships All holds. */
  total: number | undefined;
  /** The types picked, in the order picked; none is no filter. */
  picked: readonly string[];
  onPickedChange: (picked: string[]) => void;
}

const ROW = 'flex h-8.5 w-full items-center gap-2.5 rounded-sm pr-2.5 pl-8 text-left text-body outline-none hover:bg-accent focus-visible:bg-accent';

/**
 * The overview's Type filter (docs/design/fleet-overview, "Type open:
 * searchable, picks several"): its trigger names the one type picked or
 * counts several; it opens on Find a type, All with every ship, then each
 * type in mono with how many ships carry it, checked when picked. It stays
 * open while types are picked; All takes every type out.
 */
export function TypeFilter({ types, total, picked, onPickedChange }: TypeFilterProps) {
  const [find, setFind] = useState('');
  const needle = find.trim().toLowerCase();
  const shown = needle === '' ? types : types.filter(({ type }) => type.toLowerCase().includes(needle));
  const [only] = picked;
  return (
    <Popover
      onOpenChange={(isOpen) => {
        if (!isOpen) {
          setFind('');
        }
      }}
    >
      <PopoverTrigger
        aria-label="Type"
        data-testid="fleet-filter-type"
        className="inline-flex h-(--size-control-sm) shrink-0 items-center gap-1.5 rounded-md border border-input bg-card px-2.5 text-meta whitespace-nowrap text-foreground shadow-sm transition-[border-color,box-shadow] duration-(--duration-fast) outline-none hover:bg-accent focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/22 data-popup-open:border-ring [&_svg]:size-(--size-icon-sm) [&_svg]:shrink-0"
      >
        <span className="text-muted-foreground">Type</span>
        {picked.length > 1 ? (
          <span className="inline-flex size-5 items-center justify-center rounded-full bg-primary text-caption font-semibold text-primary-foreground tabular-nums">
            {picked.length}
            <span className="sr-only"> picked</span>
          </span>
        ) : (
          <span className={classNames('font-medium', only === undefined ? undefined : 'font-mono')}>{only ?? 'All'}</span>
        )}
        <ChevronDown aria-hidden className="text-muted-foreground" />
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={4} className="flex max-h-(--available-height) w-50 flex-col p-1" data-testid="fleet-filter-type-popover">
        <label className="flex h-8.5 items-center gap-2 border-b border-border px-2 text-meta text-muted-foreground [&_svg]:size-(--size-icon-sm)">
          <Search aria-hidden />
          <input
            aria-label="Find a type"
            placeholder="Find a type"
            value={find}
            onChange={(event) => {
              setFind(event.target.value);
            }}
            className="min-w-0 flex-1 bg-transparent text-foreground outline-none placeholder:text-muted-foreground"
          />
        </label>
        <div role="group" aria-label="Types" className="flex min-h-0 flex-col overflow-y-auto pt-1">
          <button
            type="button"
            aria-pressed={picked.length === 0}
            className={ROW}
            onClick={() => {
              onPickedChange([]);
            }}
          >
            <span className="flex-1">All</span>
            <span className="text-meta text-muted-foreground tabular-nums">{total}</span>
          </button>
          <div role="separator" className="-mx-1 my-1 h-px bg-border" />
          {shown.map(({ type, ships }) => {
            const isPicked = picked.includes(type);
            return (
              <button
                key={type}
                type="button"
                aria-pressed={isPicked}
                className={classNames(ROW, 'relative')}
                onClick={() => {
                  onPickedChange(isPicked ? picked.filter((each) => each !== type) : [...picked, type]);
                }}
              >
                {isPicked ? <Check aria-hidden className="absolute left-2.5 size-(--size-icon)" /> : null}
                <span className="min-w-0 flex-1 truncate font-mono text-meta">{type}</span>
                <span className="text-meta text-muted-foreground tabular-nums">{ships}</span>
              </button>
            );
          })}
          {shown.length === 0 ? <p className="px-2.5 py-2 text-meta text-muted-foreground">No type matches “{find.trim()}”.</p> : null}
        </div>
      </PopoverContent>
    </Popover>
  );
}
