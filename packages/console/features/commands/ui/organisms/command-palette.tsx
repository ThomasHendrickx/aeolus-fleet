'use client';

import { paletteEntryMatches, type AppPaletteGroup } from '@aeolus-fleet/common/rules';
import { appPaletteGroupOf, Avatar, CommandPalette as SharedCommandPalette, type CommandGroup, StatusBadge } from '@aeolus-fleet/ui';
import { Activity, DraftingCompass, Inbox, Plus, Shapes, Ship, SquarePen, UserPlus, Waves, type LucideIcon } from 'lucide-react';

import { paletteGroups, paletteKeyOf, type PaletteItem } from '../../services/command-palette';

export type { PaletteItem } from '../../services/command-palette';

interface CommandPaletteProps {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  /** Every item, before filtering; the palette filters by the query it owns. */
  items: readonly PaletteItem[];
  onSelect: (item: PaletteItem) => void;
  /** The pages and actions of the other apps the account may open, under each app's name (header-across-apps A2). */
  otherApps?: readonly AppPaletteGroup[];
  /** While the ships load. */
  isLoading?: boolean;
  /** What the search starts with when it opens; empty when not given. For stories. */
  initialQuery?: string;
  /** Each change of the query as typed, so the container reads the ships that match. */
  onQueryChange?: (query: string) => void;
}

const ICONS: Record<Extract<PaletteItem, { kind: 'action' | 'page' }>['id'], LucideIcon> = {
  compose: SquarePen,
  commission: Plus,
  'form-squadron': Plus,
  overview: Ship,
  squadrons: Shapes,
  inbox: Inbox,
  health: Activity,
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

/** The palette's groups for a query: the console's own first, then each other app's entries that match, under its name (M2). */
function groupsOf({ items, otherApps, query }: { items: readonly PaletteItem[]; otherApps: readonly AppPaletteGroup[]; query: string }): CommandGroup[] {
  const groups: CommandGroup[] = paletteGroups(items, query).map((group) => ({
    key: group.key,
    label: group.label,
    entries: group.items.map((item) => ({ key: paletteKeyOf(item), content: <ItemContent item={item} /> })),
  }));
  const others = otherApps
    .map((group) => ({ ...group, entries: group.entries.filter((entry) => paletteEntryMatches(entry, query)) }))
    .filter((group) => group.entries.length > 0)
    .map(appPaletteGroupOf);
  return [...groups, ...others];
}

/**
 * The CommandPalette (docs/design/png/CommandPalette.png), on the palette
 * every Aeolus app shows (@aeolus-fleet/ui): search ships or jump
 * to an action, a page, or another app's page or action. Actions, Ships
 * (with their StatusBadge, never argo), Go to, then each other app under its
 * name, filtered as the operator types.
 * While the ships load, rows in their shape stand in. Desktop: a dialog near
 * the top, opened with ⌘K or the Header's search. Phone: the TopBar's search
 * icon opens it full screen.
 */
export function CommandPalette({ items, otherApps = [], onSelect, isLoading = false, ...props }: CommandPaletteProps) {
  return (
    <SharedCommandPalette
      {...props}
      label="Search ships or jump to"
      isLoading={isLoading}
      groupsOf={(query) => groupsOf({ items, otherApps, query })}
      emptyMessage={(query) => `Nothing matches “${query}”. Ships are found by name or type; retired ships are not listed.`}
      onSelect={(key) => {
        const chosen = items.find((item) => paletteKeyOf(item) === key);
        if (chosen !== undefined) {
          onSelect(chosen);
        }
      }}
    />
  );
}
