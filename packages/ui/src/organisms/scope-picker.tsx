'use client';

import { Combobox } from '@base-ui/react/combobox';
import { Check, X } from 'lucide-react';
import type { ReactNode } from 'react';

/** A scope the picker offers, with what it allows as the app's server words it. */
export interface ListedScope {
  scope: string;
  description: string;
}

interface ScopeItem {
  value: string;
  description: string;
}

const itemOf = ({ scope, description }: ListedScope): ScopeItem => ({ value: scope, description });

interface ScopePickerProps {
  label: ReactNode;
  /** The scopes on offer, each with its description from the app's server. */
  listed: readonly ListedScope[];
  picked: readonly string[];
  onPick: (scopes: string[]) => void;
  /** While what was picked is saved. */
  isDisabled?: boolean;
}

/**
 * Picks several of the listed scopes, searched by code or description; each
 * picked scope is a chip with its code. A scope picked before that is no
 * longer listed stays picked, so it can be seen and removed.
 */
export function ScopePicker({ label, listed, picked, onPick, isDisabled = false }: ScopePickerProps) {
  const { contains } = Combobox.useFilter();
  const items = [...listed.map(itemOf), ...picked.filter((scope) => !listed.some((each) => each.scope === scope)).map((scope) => ({ value: scope, description: 'No longer defined in the fleet' }))];
  const value = items.filter((item) => picked.includes(item.value));
  return (
    <Combobox.Root
      multiple
      items={items}
      value={value}
      disabled={isDisabled}
      itemToStringLabel={(item) => item.value}
      isItemEqualToValue={(item, chosen) => item.value === chosen.value}
      onValueChange={(next: ScopeItem[], details) => {
        // Escape closes the list; it never takes back what was picked.
        if (details.reason === 'escape-key') {
          details.cancel();
          return;
        }
        onPick(next.map((item) => item.value));
      }}
      filter={(item: ScopeItem, query) => contains(item.value, query) || contains(item.description, query)}
    >
      <div className="grid gap-1.5" data-testid="scope-picker">
        <Combobox.Label className="text-body font-medium text-foreground">{label}</Combobox.Label>
        <Combobox.InputGroup className="flex min-h-(--size-control) flex-wrap items-center gap-1 rounded-md border border-input bg-background px-2 py-1 has-disabled:opacity-50">
          <Combobox.Chips className="contents">
            {value.map((item) => (
              <Combobox.Chip key={item.value} data-testid="scope-picker-chip" className="inline-flex items-center gap-1 rounded-sm border border-border bg-muted px-1.5 font-mono text-id text-foreground" aria-label={item.value}>
                {item.value}
                <Combobox.ChipRemove className="text-muted-foreground hover:text-foreground" aria-label={`Remove ${item.value}`}>
                  <X aria-hidden className="size-3" />
                </Combobox.ChipRemove>
              </Combobox.Chip>
            ))}
            <Combobox.Input data-testid="scope-picker-search" placeholder={value.length === 0 ? 'Search the fleet\'s scopes' : ''} className="h-6 min-w-32 flex-1 bg-transparent text-body outline-none placeholder:text-muted-foreground" />
          </Combobox.Chips>
        </Combobox.InputGroup>
      </div>
      <Combobox.Portal>
        <Combobox.Positioner sideOffset={4} className="z-50">
          <Combobox.Popup className="max-h-72 w-(--anchor-width) overflow-auto rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md">
            <Combobox.Empty className="px-2 py-1 text-meta text-muted-foreground empty:hidden">No scope listed matches.</Combobox.Empty>
            <Combobox.List>
              {(item: ScopeItem) => (
                <Combobox.Item key={item.value} value={item} data-testid="scope-picker-option" className="grid cursor-default grid-cols-[1rem_1fr] gap-x-2 rounded-sm px-2 py-1 data-highlighted:bg-accent">
                  <Combobox.ItemIndicator className="row-span-2 pt-0.5">
                    <Check aria-hidden className="size-3.5" />
                  </Combobox.ItemIndicator>
                  <span className="col-start-2 font-mono text-code">{item.value}</span>
                  <span className="col-start-2 text-meta text-muted-foreground">{item.description}</span>
                </Combobox.Item>
              )}
            </Combobox.List>
          </Combobox.Popup>
        </Combobox.Positioner>
      </Combobox.Portal>
    </Combobox.Root>
  );
}
