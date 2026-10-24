'use client';

import { Avatar, CommandPalette as SharedCommandPalette, type CommandGroup } from '@aeolus-fleet/common/header';
import { Activity, AppWindow, DraftingCompass, Inbox, Plus, Shapes, Ship, SquarePen, UserPlus, Waves, type LucideIcon } from 'lucide-react';

import { paletteGroups, paletteKeyOf, type PaletteItem } from '../../services/command-palette';
import { StatusBadge } from '../../../../components/molecules/status-badge';

export type { PaletteItem } from '../../services/command-palette';

interface CommandPaletteProps {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  /** Every item, before filtering; the palette filters by the query it owns. */
  items: readonly PaletteItem[];
  onSelect: (item: PaletteItem) => void;
  /** The other apps the account may open, from the header's switcher. */
  apps?: readonly PaletteApp[];
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

/** An app the palette opens (header design): another Aeolus app the account may open in this fleet, or outside any. */
export interface PaletteApp {
  label: string;
  url: string;
}

/** The palette's groups for a query, each item an entry whose content it shows; then the apps that match, which open in place of this one. */
function groupsOf({ items, apps, query }: { items: readonly PaletteItem[]; apps: readonly PaletteApp[]; query: string }): CommandGroup[] {
  const wanted = query.trim().toLowerCase();
  const groups: CommandGroup[] = paletteGroups(items, query).map((group) => ({
    key: group.key,
    label: group.label,
    entries: group.items.map((item) => ({ key: paletteKeyOf(item), content: <ItemContent item={item} /> })),
  }));
  const matching = apps.filter((app) => app.label.toLowerCase().includes(wanted));
  return matching.length === 0
    ? groups
    : [
        ...groups,
        {
          key: 'apps',
          label: 'Apps',
          entries: matching.map((app) => ({
            key: `app:${app.label}`,
            href: app.url,
            name: app.label,
            content: (
              <>
                <AppWindow aria-hidden className="size-(--size-icon) shrink-0 text-muted-foreground" />
                <span className="min-w-0 truncate">{app.label}</span>
              </>
            ),
          })),
        },
      ];
}

/**
 * The CommandPalette (docs/design/png/CommandPalette.png), on the palette
 * every Aeolus app shows (@aeolus-fleet/common/header): search ships or jump
 * to an action, a page or another app. Actions, Ships (with their
 * StatusBadge, never argo), Go to and Apps, filtered as the operator types.
 * While the ships load, rows in their shape stand in. Desktop: a dialog near
 * the top, opened with ⌘K or the Header's search. Phone: the TopBar's search
 * icon opens it full screen.
 */
export function CommandPalette({ items, apps = [], onSelect, isLoading = false, ...props }: CommandPaletteProps) {
  return (
    <SharedCommandPalette
      {...props}
      label="Search ships or jump to"
      isLoading={isLoading}
      groupsOf={(query) => groupsOf({ items, apps, query })}
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
