'use client';

import { Combobox as ComboboxPrimitive } from '@base-ui/react/combobox';
import { Check } from 'lucide-react';
import { useState, type ReactNode } from 'react';

import { classNames } from '../../lib/class-names';
import { inputVariants } from './input';

/** One suggestion: what it stands for, the words it is found by, and what it shows beside them. */
export interface ComboboxOption {
  value: string;
  /** Shown in mono, and what the operator's typing is matched against. */
  label: string;
  /** Muted words after the label: "reviewer · hetzner-1". */
  detail?: string;
  /** At the end of the row: a StatusBadge, "2 ships". */
  trailing?: ReactNode;
}

interface ComboboxProps {
  options: readonly ComboboxOption[];
  /** The chosen option's value; with free text, the text typed. Null while empty. */
  value: string | null;
  onValueChange: (value: string | null) => void;
  /** The typed text is the value, and the options only suggest (ship type). */
  isFreeText?: boolean;
  /** A label over the suggestions: "Ships". */
  groupLabel?: string;
  /** What the popup says when nothing matches the typed text. */
  emptyText?: (query: string) => ReactNode;
  /** A decorative icon inside the field, before the text. */
  leadingIcon?: ReactNode;
  placeholder?: string;
  id?: string;
  /** Draws the invalid ring; the error itself sits under the field, outside this atom. */
  isInvalid?: boolean;
  'aria-describedby'?: string;
  'aria-label'?: string;
  'data-testid'?: string;
}

function matches(option: ComboboxOption, query: string): boolean {
  return option.label.toLowerCase().includes(query.trim().toLowerCase());
}

/**
 * shadcn Combobox on Base UI, themed to docs/design/png/Combobox.png:
 * search-as-you-type for ships and types. Suggestions open only after the
 * operator types, never on focus alone. Without free text the value is a
 * chosen option, and typing over it clears it; with free text the typed text
 * is the value and the options only suggest. While the chosen option's label
 * shows in the field, its detail and trailing node show beside it. The field
 * keeps what was typed for as long as it is mounted: the owner remounts it
 * (with a key) to start over.
 */
export function Combobox({
  options,
  value,
  onValueChange,
  isFreeText = false,
  groupLabel,
  emptyText,
  leadingIcon,
  placeholder,
  id,
  isInvalid = false,
  'aria-describedby': describedBy,
  'aria-label': label,
  'data-testid': testId,
}: ComboboxProps) {
  const selected = options.find((option) => option.value === value);
  const [query, setQuery] = useState(selected?.label ?? (isFreeText ? (value ?? '') : ''));
  const [isOpen, setIsOpen] = useState(false);
  const shown = options.filter((option) => matches(option, query));
  /** The chosen option while its label shows in the field: its detail and trailing node show beside it. */
  const shownInField = selected?.label === query ? selected : undefined;
  const hasBesideLabel = shownInField !== undefined && (shownInField.detail !== undefined || shownInField.trailing !== undefined);
  const chosen = isFreeText ? options.find((option) => option.label === query) : selected;

  return (
    <ComboboxPrimitive.Root<ComboboxOption>
      items={shown}
      filter={null}
      value={chosen ?? null}
      itemToStringLabel={(option) => option.label}
      isItemEqualToValue={(option, other) => option.value === other.value}
      inputValue={query}
      open={isOpen && query.trim() !== ''}
      onOpenChange={setIsOpen}
      onInputValueChange={(text, details) => {
        // With free text the typed text is the value: only typing or a chosen
        // suggestion changes it. Base UI would otherwise reset it to the
        // selected item's label (none) when the field loses focus.
        if (isFreeText && details.reason !== 'input-change' && details.reason !== 'item-press') {
          return;
        }
        setQuery(text);
        if (isFreeText) {
          onValueChange(text === '' ? null : text);
        } else if (selected !== undefined && text !== selected.label) {
          onValueChange(null);
        }
      }}
      onValueChange={(option) => {
        if (option) {
          setQuery(option.label);
          onValueChange(isFreeText ? option.label : option.value);
        }
      }}
    >
      <div className="relative w-full [&_svg]:size-(--size-icon)">
        {leadingIcon ? (
          <span
            aria-hidden
            className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-muted-foreground"
          >
            {leadingIcon}
          </span>
        ) : null}
        <ComboboxPrimitive.Input
          id={id}
          placeholder={placeholder}
          aria-invalid={isInvalid}
          aria-describedby={describedBy}
          aria-label={label}
          data-testid={testId}
          data-slot="combobox-input"
          className={classNames(
            inputVariants({ isMono: true }),
            leadingIcon ? 'pl-9' : undefined,
            hasBesideLabel ? 'pr-44 max-sm:pr-28' : undefined,
          )}
        />
        {hasBesideLabel ? (
          <span className="pointer-events-none absolute inset-y-0 right-2.5 flex items-center gap-2">
            {shownInField.detail ? (
              <span className="truncate text-meta text-muted-foreground max-sm:hidden">{shownInField.detail}</span>
            ) : null}
            {shownInField.trailing}
          </span>
        ) : null}
      </div>
      <ComboboxPrimitive.Portal>
        <ComboboxPrimitive.Positioner className="isolate z-50 outline-none" sideOffset={4}>
          <ComboboxPrimitive.Popup
            data-slot="combobox-content"
            className="max-h-(--available-height) w-(--anchor-width) origin-(--transform-origin) overflow-y-auto rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-lg duration-(--duration-fast) outline-none data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0"
          >
            {emptyText ? (
              <ComboboxPrimitive.Empty className="px-2.5 py-2 text-meta text-muted-foreground empty:hidden">
                {emptyText(query.trim())}
              </ComboboxPrimitive.Empty>
            ) : null}
            <ComboboxPrimitive.List>
              {groupLabel && shown.length > 0 ? (
                <div className="px-2.5 pt-1.5 pb-1 text-caption text-muted-foreground">{groupLabel}</div>
              ) : null}
              {shown.map((option) => (
                <ComboboxPrimitive.Item
                  key={option.value}
                  value={option}
                  data-slot="combobox-item"
                  className="relative flex min-h-8.5 items-center gap-2.5 rounded-sm pr-8 pl-2.5 text-body text-foreground outline-none select-none data-disabled:pointer-events-none data-disabled:opacity-45 data-highlighted:bg-accent"
                >
                  <span className="font-mono text-id font-medium">{option.label}</span>
                  {option.detail ? <span className="truncate text-meta text-muted-foreground">{option.detail}</span> : null}
                  {option.trailing ? <span className="ml-auto flex items-center">{option.trailing}</span> : null}
                  <ComboboxPrimitive.ItemIndicator className="absolute right-2.5 flex items-center">
                    <Check aria-hidden className="size-(--size-icon)" />
                  </ComboboxPrimitive.ItemIndicator>
                </ComboboxPrimitive.Item>
              ))}
            </ComboboxPrimitive.List>
          </ComboboxPrimitive.Popup>
        </ComboboxPrimitive.Positioner>
      </ComboboxPrimitive.Portal>
    </ComboboxPrimitive.Root>
  );
}
