'use client';

import { CornerDownLeft, DraftingCompass, Inbox, Plus, Search, Shapes, Ship, SquarePen, TriangleAlert, UserPlus, Waves, type LucideIcon } from 'lucide-react';
import { useId, useState, type KeyboardEvent } from 'react';

import { classNames } from '../../lib/class-names';
import { paletteGroups, paletteKeyOf, type PaletteItem } from '../../lib/command-palette';
import { Avatar } from '../atoms/avatar';
import { Button } from '../atoms/button';
import { Dialog, DialogClose, DialogContent, DialogTitle } from '../atoms/dialog';
import { dialogSurface } from '../atoms/dialog-surface';
import { Kbd } from '../atoms/kbd';
import { StatusBadge } from '../molecules/status-badge';

export type { PaletteItem } from '../../lib/command-palette';

interface CommandPaletteProps {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  /** Every item, before filtering; the palette filters by the query it owns. */
  items: readonly PaletteItem[];
  onSelect: (item: PaletteItem) => void;
  /** What the search starts with when it opens; empty when not given. For stories. */
  initialQuery?: string;
}

const ICONS: Record<Extract<PaletteItem, { kind: 'action' | 'page' }>['id'], LucideIcon> = {
  compose: SquarePen,
  commission: Plus,
  'form-squadron': Plus,
  overview: Ship,
  squadrons: Shapes,
  inbox: Inbox,
  attention: TriangleAlert,
};

/** One option: an icon and label, or a ship by its name, type and status. */
function ItemContent({ item }: { item: PaletteItem }) {
  if (item.kind === 'ship') {
    return (
      <>
        <Avatar name={item.name} size={20} />
        <span className="min-w-0 truncate font-mono text-body font-medium text-foreground">{item.name}</span>
        <span className="min-w-0 truncate text-meta text-muted-foreground">{item.type}</span>
        <StatusBadge status={item.status} className="ml-auto" />
      </>
    );
  }
  if (item.kind === 'squadron') {
    return (
      <>
        <Shapes aria-hidden className="size-(--size-icon) shrink-0 text-muted-foreground" />
        <span className="min-w-0 truncate text-body font-medium text-foreground">{item.id}</span>
        <span className="min-w-0 truncate font-mono text-meta text-muted-foreground">{item.blueprint}</span>
        <StatusBadge status={item.state} className="ml-auto" />
      </>
    );
  }
  if (item.kind === 'blueprint') {
    return (
      <>
        <DraftingCompass aria-hidden className="size-(--size-icon) shrink-0 text-muted-foreground" />
        <span className="min-w-0 truncate font-mono text-body text-foreground">{item.name}</span>
        <span className="text-meta text-muted-foreground">v{item.version}</span>
      </>
    );
  }
  if (item.kind === 'squadron-action') {
    const ActionIcon = item.action === 'add-member' ? UserPlus : Waves;
    return (
      <>
        <ActionIcon aria-hidden className="size-(--size-icon) shrink-0 text-muted-foreground" />
        <span className="min-w-0 truncate">{item.label}</span>
      </>
    );
  }
  const Icon = ICONS[item.id];
  return (
    <>
      <Icon aria-hidden className="size-(--size-icon) shrink-0 text-muted-foreground" />
      <span className="min-w-0 truncate">{item.label}</span>
    </>
  );
}

/** The open palette: its query and the option the keys move to live here, so each opening starts fresh. */
function PaletteBody({ items, onSelect, onOpenChange, initialQuery = '' }: Omit<CommandPaletteProps, 'isOpen'>) {
  const listId = useId();
  const optionId = useId();
  const [query, setQuery] = useState(initialQuery);
  const [activeIndex, setActiveIndex] = useState(0);
  const groups = paletteGroups(items, query);
  const options = groups.flatMap((group) => group.items);
  const active = options[Math.min(activeIndex, options.length - 1)];
  const idOf = (item: PaletteItem) => `${optionId}-${paletteKeyOf(item)}`;

  const choose = (item: PaletteItem) => {
    onSelect(item);
    onOpenChange(false);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (options.length === 0) {
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      const current = active ? options.indexOf(active) : 0;
      setActiveIndex((current + step + options.length) % options.length);
    } else if (event.key === 'Enter' && active) {
      event.preventDefault();
      choose(active);
    }
  };

  return (
    <>
      <DialogTitle className="sr-only">Search ships or jump to</DialogTitle>
      <div className="flex h-12 items-center gap-2.5 border-b border-border px-4 max-sm:h-(--size-header)">
        <Search aria-hidden className="size-(--size-icon) shrink-0 text-muted-foreground" />
        <input
          role="combobox"
          aria-expanded
          aria-controls={listId}
          aria-activedescendant={active ? idOf(active) : undefined}
          aria-autocomplete="list"
          aria-label="Search ships or jump to"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          placeholder="Search ships or jump to"
          data-testid="command-palette-input"
          className="h-full min-w-0 grow bg-transparent text-body text-foreground outline-none placeholder:text-muted-foreground max-sm:text-body-touch"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActiveIndex(0);
          }}
          onKeyDown={onKeyDown}
        />
        <Kbd>esc</Kbd>
        <DialogClose render={<Button variant="ghost" size="sm" className="sm:hidden" />}>Cancel</DialogClose>
      </div>
      <div className="max-h-[min(60dvh,var(--spacing)*100)] overflow-y-auto p-2 max-sm:max-h-none max-sm:grow">
        {options.length === 0 ? (
          <p className="px-4 py-6 text-center text-meta text-muted-foreground">
            Nothing matches “{query.trim()}”. Ships are found by name or type; retired ships are not listed.
          </p>
        ) : (
          <ul id={listId} role="listbox" aria-label="Results" className="flex flex-col gap-2">
            {groups.map((group) => (
              <li key={group.key} role="presentation" className="flex flex-col gap-0.5">
                <p id={`${listId}-${group.key}`} className="px-2.5 pt-1 pb-0.5 text-caption font-medium text-muted-foreground">
                  {group.label}
                </p>
                <ul role="group" aria-labelledby={`${listId}-${group.key}`} className="flex flex-col gap-0.5">
                  {group.items.map((item) => {
                    const isActive = item === active;
                    return (
                      // The keys belong to the search field (aria-activedescendant
                      // names the active option), as the combobox pattern wants;
                      // the pointer chooses an option directly.
                      // eslint-disable-next-line jsx-a11y-x/click-events-have-key-events
                      <li
                        key={paletteKeyOf(item)}
                        id={idOf(item)}
                        role="option"
                        aria-selected={isActive}
                        data-testid="command-palette-item"
                        data-item-kind={item.kind}
                        data-item-id={item.id}
                        className={classNames(
                          'flex h-(--size-control) cursor-pointer items-center gap-2.5 rounded-md px-2.5 text-body text-foreground max-sm:h-(--size-control-touch)',
                          isActive ? 'bg-accent' : undefined,
                        )}
                        onPointerMove={() => {
                          setActiveIndex(options.indexOf(item));
                        }}
                        onClick={() => {
                          choose(item);
                        }}
                      >
                        <ItemContent item={item} />
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
 * The CommandPalette (docs/design/png/CommandPalette.png): search ships or
 * jump to an action or a page. Actions, Ships (with their StatusBadge, never
 * argo) and Go to, filtered as the operator types. Arrow keys move, Enter
 * opens, Escape closes. Desktop: a dialog near the top, opened with ⌘K or the
 * Header's search. Phone: the TopBar's search icon opens it full screen.
 */
export function CommandPalette({ isOpen, onOpenChange, ...body }: CommandPaletteProps) {
  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent
        size="md"
        data-testid="command-palette"
        className={classNames(
          'gap-0 p-0 sm:top-[12dvh] sm:translate-y-0',
          dialogSurface.phoneFullScreen,
          'max-sm:flex max-sm:flex-col',
        )}
      >
        <PaletteBody onOpenChange={onOpenChange} {...body} />
      </DialogContent>
    </Dialog>
  );
}
