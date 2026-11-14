'use client';

import { Combobox as ComboboxPrimitive } from '@base-ui/react/combobox';
import { Check, ChevronsUpDown } from 'lucide-react';
import { useState, type ReactNode } from 'react';

import { classNames, inputVariants } from '@aeolus-fleet/ui';

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
  /** Turns what the operator types into the text the field holds, such as lowercase for a ship name or type. */
  toQuery?: (typed: string) => string;
  /** A label over the suggestions: "Ships". */
  groupLabel?: string;
  /** Options kept apart, after a separator below the others: argo as an owner, the fallback. */
  apartOptions?: readonly ComboboxOption[];
  /**
   * A picker: a chevron button opens the list with nothing typed, and while
   * the chosen option's label shows in the field the list holds every option,
   * so another can be picked without clearing the field first.
   */
  hasListButton?: boolean;
  /** Each change of the typed text, so the owner can ask the server for the options that match. */
  onQueryChange?: (query: string) => void;
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

/** One row of the list: the label in mono, its detail, its trailing node, and a check when chosen. */
function ComboboxItem({ option }: { option: ComboboxOption }) {
  return (
    <ComboboxPrimitive.Item
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
  );
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
  toQuery,
  onQueryChange,
  groupLabel,
  apartOptions = [],
  hasListButton = false,
  emptyText,
  leadingIcon,
  placeholder,
  id,
  isInvalid = false,
  'aria-describedby': describedBy,
  'aria-label': label,
  'data-testid': testId,
}: ComboboxProps) {
  const selected = [...options, ...apartOptions].find((option) => option.value === value);
  const [query, setQuery] = useState(selected?.label ?? (isFreeText ? (value ?? '') : ''));
  const [isOpen, setIsOpen] = useState(false);
  const isListedWhole = hasListButton && selected?.label === query;
  const shown = isListedWhole ? options : options.filter((option) => matches(option, query));
  const shownApart = isListedWhole ? apartOptions : apartOptions.filter((option) => matches(option, query));
  /** The chosen option while its label shows in the field: its detail and trailing node show beside it. */
  const shownInField = selected?.label === query ? selected : undefined;
  // A picker shows only the label in the field: its list marks the chosen one.
  const hasBesideLabel = !hasListButton && shownInField !== undefined && (shownInField.detail !== undefined || shownInField.trailing !== undefined);
  const chosen = isFreeText ? options.find((option) => option.label === query) : selected;

  return (
    <ComboboxPrimitive.Root<ComboboxOption>
      items={[...shown, ...shownApart]}
      filter={null}
      value={chosen ?? null}
      itemToStringLabel={(option) => option.label}
      isItemEqualToValue={(option, other) => option.value === other.value}
      inputValue={query}
      open={isOpen && (hasListButton || query.trim() !== '')}
      onOpenChange={setIsOpen}
      onInputValueChange={(text, details) => {
        // With free text the typed text is the value: only typing or a chosen
        // suggestion changes it. Base UI would otherwise reset it to the
        // selected item's label (none) when the field loses focus.
        if (isFreeText && details.reason !== 'input-change' && details.reason !== 'item-press') {
          return;
        }
        const typed = details.reason === 'input-change' && toQuery ? toQuery(text) : text;
        setQuery(typed);
        if (details.reason === 'input-change') {
          onQueryChange?.(typed);
        }
        if (isFreeText) {
          onValueChange(typed === '' ? null : typed);
        } else if (details.reason !== 'item-press' && selected !== undefined && typed !== selected.label) {
          // A pressed item sets the value itself: its label differs from the one chosen before.
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
            hasListButton ? 'pr-9' : undefined,
          )}
        />
        {hasListButton ? (
          <ComboboxPrimitive.Trigger
            aria-label="Show the choices"
            className="absolute inset-y-0 right-0 flex w-9 items-center justify-center rounded-r-md text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ChevronsUpDown aria-hidden />
          </ComboboxPrimitive.Trigger>
        ) : null}
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
                <ComboboxItem key={option.value} option={option} />
              ))}
              {shownApart.length > 0 ? (
                <>
                  {shown.length > 0 ? <ComboboxPrimitive.Separator data-slot="combobox-separator" className="-mx-1 my-1 h-px bg-border" /> : null}
                  {shownApart.map((option) => (
                    <ComboboxItem key={option.value} option={option} />
                  ))}
                </>
              ) : null}
            </ComboboxPrimitive.List>
          </ComboboxPrimitive.Popup>
        </ComboboxPrimitive.Positioner>
      </ComboboxPrimitive.Portal>
    </ComboboxPrimitive.Root>
  );
}
