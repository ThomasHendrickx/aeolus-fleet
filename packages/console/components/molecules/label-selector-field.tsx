'use client';

import type { SelectorTerm } from '@aeolus-fleet/common';
import { CircleAlert, Plus, X } from 'lucide-react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { Fragment, useState } from 'react';

import type { FilterGroup } from '../../lib/labels';
import { TERM_MEANINGS, termKeyOf, type TermChip } from '../../lib/network-rules';
import { Button } from '../atoms/button';
import { Popover, PopoverContent, PopoverTrigger } from '../atoms/popover';
import { LabelChip } from './label-chip';

// Loads when its popover first opens, not with the page.
const LabelPicker = dynamic(() => import('./label-picker').then((module) => module.LabelPicker), { ssr: false });

interface LabelSelectorFieldProps {
  /** What the side is, as a sentence starts it: "From ships with", "To ships with". */
  label: string;
  /** The terms picked, as chips, in the order picked. */
  picked: readonly TermChip[];
  /** Terms whose value or label the fleet no longer has: they match no ship, so the side matches none (decision 0034). */
  unknown: readonly SelectorTerm[];
  /** Every key, by owner, each value with how many ships carry it. */
  groups: readonly FilterGroup[];
  /** The most values a selector holds: Add label goes once as many are picked. */
  max: number;
  isDisabled?: boolean;
  /** What is wrong with the side as it stands, said under it: a term of the same value the other side lacks. */
  problem?: string;
  onAdd: (term: SelectorTerm) => void;
  onRemove: (term: SelectorTerm) => void;
  /** The testid stem: `<stem>-add`, `<stem>-popover`, `<stem>-value`. */
  testId: string;
  /** The popover's testid, shared by every side of a list. */
  popoverTestId: string;
}

/**
 * One side of a network rule (decision 0034): the terms a ship must meet,
 * every one, joined by "and"; none picked is every ship. Each term a chip
 * with ×: an exact value, any value of a key (`key=*`) or the same value as
 * the other side (`key=#`); then Add label, a key and one of those. A value the
 * fleet no longer has shows as a warning, removable: while it is there the
 * side matches no ship. Props only.
 */
export function LabelSelectorField({ label, picked, unknown, groups, max, isDisabled, problem, onAdd, onRemove, testId, popoverTestId }: LabelSelectorFieldProps) {
  const [isOpen, setIsOpen] = useState(false);
  return (
    <div className="flex flex-col gap-1" data-testid={testId}>
      <span className="text-meta text-muted-foreground">{label}</span>
      <div className="flex min-h-(--size-control-sm) flex-wrap items-center gap-1.5">
        {picked.length + unknown.length === 0 ? <span className="text-body">Every ship</span> : null}
        {picked.map((chip, index) => (
          <Fragment key={termKeyOf(chip.term)}>
            {index === 0 ? null : <span className="text-meta text-muted-foreground">and</span>}
            <LabelChip
              chip={chip}
              testId={`${testId}-value`}
              {...(typeof chip.term === 'string' ? {} : { meaning: TERM_MEANINGS[chip.term.value] })}
              {...(isDisabled
                ? {}
                : {
                    onRemove: () => {
                      onRemove(chip.term);
                    },
                  })}
            />
          </Fragment>
        ))}
        {unknown.map((term) => (
          <span
            key={termKeyOf(term)}
            data-testid={`${testId}-unknown`}
            title={`${termKeyOf(term)}: no longer in this fleet`}
            className="inline-flex h-5.5 items-center gap-1 rounded-sm border border-tone-attention-border bg-tone-attention-bg px-1.5 text-id text-tone-attention-fg [&_svg]:size-3"
          >
            <CircleAlert aria-hidden />
            A removed label
            {isDisabled === true ? null : (
              <button
                type="button"
                aria-label="Remove the removed label"
                onClick={() => {
                  onRemove(term);
                }}
                className="-mr-1 ml-0.5 inline-flex size-4 items-center justify-center rounded-xs hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring"
              >
                <X aria-hidden />
              </button>
            )}
          </span>
        ))}
        {picked.length + unknown.length >= max ? null : (
          <Popover open={isOpen} onOpenChange={setIsOpen}>
            <PopoverTrigger render={<Button type="button" variant="ghost" size="xs" icon={<Plus />} disabled={isDisabled} data-testid={`${testId}-add`} />}>Add label</PopoverTrigger>
            <PopoverContent align="start" sideOffset={6} className="w-80 p-2" data-testid={popoverTestId}>
              <span className="block px-2 pt-1 pb-2 text-body font-medium">{label}</span>
              <LabelPicker
                groups={groups}
                pickedValueIds={picked.flatMap((chip) => (typeof chip.term === 'string' ? [chip.term] : []))}
                onPick={(valueId) => {
                  setIsOpen(false);
                  onAdd(valueId);
                }}
                terms={{
                  picked: picked.flatMap((chip) => (typeof chip.term === 'string' ? [] : [chip.term])),
                  onPick: (term) => {
                    setIsOpen(false);
                    onAdd(term);
                  },
                }}
              />
              <p className="mt-2 flex items-center justify-between gap-2 border-t border-border px-2 pt-2 text-meta text-muted-foreground">
                All must hold. * is any value, # the same as the other side.
                <Link href="/labels" className="font-medium text-foreground hover:underline">
                  Manage labels
                </Link>
              </p>
            </PopoverContent>
          </Popover>
        )}
      </div>
      {problem === undefined ? null : (
        <p role="status" className="text-meta text-tone-attention-fg" data-testid={`${testId}-problem`}>
          {problem}
        </p>
      )}
      {unknown.length === 0 ? null : (
        <p role="alert" className="text-meta text-tone-attention-fg">
          A label here was removed from the fleet: this side matches no ship until you remove it.
        </p>
      )}
    </div>
  );
}
