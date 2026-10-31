'use client';

import { CornerDownLeft, LoaderCircle, Search } from 'lucide-react';
import { useId, useState, type KeyboardEvent, type ReactNode } from 'react';

import { Button } from '../atoms/button.js';
import { Dialog, DialogClose, DialogContent, DialogTitle } from '../atoms/dialog.js';
import { dialogSurface } from '../atoms/dialog-surface.js';
import { Kbd } from '../atoms/kbd.js';
import { classNames } from '../class-names.js';

/**
 * One entry of the palette: what it shows, and where it goes. An entry with
 * an href opens another app: the browser leaves, so the palette stays open
 * and says "Opening ..." until it does. Any other entry is handed to
 * onSelect and the palette closes.
 */
export interface CommandEntry {
  key: string;
  content: ReactNode;
  href?: string;
  /** The name "Opening ..." uses for an entry with an href. */
  name?: string;
}

export interface CommandGroup {
  key: string;
  label: string;
  entries: readonly CommandEntry[];
}

export interface CommandPaletteProps {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  /** The groups to show for what is typed: the app filters, and leaves out an empty group. */
  groupsOf: (query: string) => readonly CommandGroup[];
  onSelect: (key: string) => void;
  /** The search field's name and placeholder: "Search ships or jump to". */
  label: string;
  /** What to say when nothing matches what is typed. */
  emptyMessage: (query: string) => string;
  /** While the entries load, rows in their shape stand in. */
  isLoading?: boolean;
  /** What the search starts with when it opens; empty when not given. For stories. */
  initialQuery?: string;
  /** Each change of the query as typed, so the app can ask the server for what matches. */
  onQueryChange?: (query: string) => void;
}

/** Rows standing in while the entries load. */
const SKELETON_ROWS = 4;

function LoadingRows() {
  return (
    <ul aria-label="Loading" aria-busy data-testid="command-palette-loading" className="flex flex-col gap-1 p-1">
      {Array.from({ length: SKELETON_ROWS }, (_, row) => `row-${String(row)}`).map((row) => (
        <li key={row} className="flex h-(--size-control) items-center gap-2.5 px-2.5 max-sm:h-(--size-control-touch)">
          <span className="size-5 shrink-0 animate-pulse rounded-full bg-muted motion-reduce:animate-none" />
          <span className="h-3 w-40 animate-pulse rounded bg-muted motion-reduce:animate-none" />
        </li>
      ))}
    </ul>
  );
}

/** The open palette: its query, the entry the keys move to and the one opening live here, so each opening starts fresh. */
function PaletteBody({ groupsOf, onSelect, onOpenChange, label, emptyMessage, isLoading = false, initialQuery = '', onQueryChange }: Omit<CommandPaletteProps, 'isOpen'>) {
  const listId = useId();
  const optionId = useId();
  const [query, setQuery] = useState(initialQuery);
  const [activeIndex, setActiveIndex] = useState(0);
  const [opening, setOpening] = useState<CommandEntry | undefined>(undefined);
  const groups = groupsOf(query);
  const entries = groups.flatMap((group) => group.entries);
  const active = entries[Math.min(activeIndex, entries.length - 1)];
  const idOf = (entry: CommandEntry) => `${optionId}-${entry.key}`;

  const choose = (entry: CommandEntry) => {
    if (opening !== undefined) {
      return;
    }
    if (entry.href !== undefined) {
      setOpening(entry);
      window.location.assign(entry.href);
      return;
    }
    onSelect(entry.key);
    onOpenChange(false);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (entries.length === 0) {
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      const current = active ? entries.indexOf(active) : 0;
      setActiveIndex((current + step + entries.length) % entries.length);
    } else if (event.key === 'Enter' && active) {
      event.preventDefault();
      choose(active);
    }
  };

  return (
    <>
      <DialogTitle className="sr-only">{label}</DialogTitle>
      <div className="flex h-12 items-center gap-2.5 border-b border-border px-4 max-sm:h-(--size-header)">
        <Search aria-hidden className="size-(--size-icon) shrink-0 text-muted-foreground" />
        <input
          role="combobox"
          aria-expanded
          aria-controls={listId}
          aria-activedescendant={active ? idOf(active) : undefined}
          aria-autocomplete="list"
          aria-label={label}
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          placeholder={label}
          disabled={opening !== undefined}
          data-testid="command-palette-input"
          className="h-full min-w-0 grow bg-transparent text-body text-foreground outline-none placeholder:text-muted-foreground disabled:opacity-60 max-sm:text-body-touch"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActiveIndex(0);
            onQueryChange?.(event.target.value);
          }}
          onKeyDown={onKeyDown}
        />
        <Kbd>esc</Kbd>
        <DialogClose render={<Button variant="ghost" size="sm" className="sm:hidden" />}>Cancel</DialogClose>
      </div>
      <div className="max-h-[min(60dvh,var(--spacing)*100)] overflow-y-auto p-2 max-sm:max-h-none max-sm:grow">
        {entries.length === 0 && isLoading ? <LoadingRows /> : null}
        {entries.length === 0 && !isLoading ? <p className="px-4 py-6 text-center text-meta text-muted-foreground">{emptyMessage(query.trim())}</p> : null}
        {entries.length === 0 ? null : (
          <ul id={listId} role="listbox" aria-label="Results" className="flex flex-col gap-2">
            {groups.map((group) => (
              <li key={group.key} role="presentation" className="flex flex-col gap-0.5">
                <p id={`${listId}-${group.key}`} className="px-2.5 pt-1 pb-0.5 text-caption font-medium text-muted-foreground">
                  {group.label}
                </p>
                <ul role="group" aria-labelledby={`${listId}-${group.key}`} className="flex flex-col gap-0.5">
                  {group.entries.map((entry) => {
                    const isActive = entry === active;
                    const isOpening = entry === opening;
                    return (
                      // The keys belong to the search field (aria-activedescendant
                      // names the active option), as the combobox pattern wants;
                      // the pointer chooses an option directly.
                      // eslint-disable-next-line jsx-a11y-x/click-events-have-key-events
                      <li
                        key={entry.key}
                        id={idOf(entry)}
                        role="option"
                        aria-selected={isActive}
                        aria-disabled={opening !== undefined && !isOpening ? true : undefined}
                        data-testid="command-palette-item"
                        data-item-key={entry.key}
                        className={classNames(
                          'flex h-(--size-control) cursor-pointer items-center gap-2.5 rounded-md px-2.5 text-body text-foreground aria-disabled:opacity-60 max-sm:h-(--size-control-touch)',
                          isActive ? 'bg-accent' : undefined,
                        )}
                        onPointerMove={() => {
                          setActiveIndex(entries.indexOf(entry));
                        }}
                        onClick={() => {
                          choose(entry);
                        }}
                      >
                        {isOpening ? (
                          <>
                            <LoaderCircle aria-hidden className="size-(--size-icon) shrink-0 animate-spin text-muted-foreground motion-reduce:animate-none" />
                            <span className="min-w-0 truncate">Opening {entry.name ?? ''}</span>
                          </>
                        ) : (
                          entry.content
                        )}
                      </li>
                    );
                  })}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="flex items-center gap-3 border-t border-border px-4 py-2 text-caption text-muted-foreground max-sm:hidden">
        <span className="inline-flex items-center gap-1">
          <Kbd>↑</Kbd>
          <Kbd>↓</Kbd>
          Move
        </span>
        <span className="inline-flex items-center gap-1">
          <Kbd>
            <CornerDownLeft aria-hidden className="size-3" />
          </Kbd>
          Open
        </span>
        <span className="inline-flex items-center gap-1">
          <Kbd>esc</Kbd>
          Close
        </span>
      </div>
    </>
  );
}

/**
 * The command palette (header design, docs/design/png/CommandPalette.png):
 * search, then the app's groups of entries, filtered as you type. Arrow keys
 * move, Enter opens, Escape closes. Desktop: a dialog near the top, opened
 * with ⌘K or the header's search. Phone: the search icon opens it full
 * screen (H6). While the entries load, rows in their shape stand in.
 */
export function CommandPalette({ isOpen, onOpenChange, ...body }: CommandPaletteProps) {
  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent
        size="md"
        data-testid="command-palette"
        className={classNames('gap-0 p-0 sm:top-[12dvh] sm:translate-y-0', dialogSurface.phoneFullScreen, 'max-sm:flex max-sm:flex-col')}
      >
        <PaletteBody onOpenChange={onOpenChange} {...body} />
      </DialogContent>
    </Dialog>
  );
}
