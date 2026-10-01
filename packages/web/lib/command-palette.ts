import type { ListedShip, ShipId, ShipStatus } from '@aeolus-fleet/common';

/**
 * What the CommandPalette offers (docs/design/png/CommandPalette.png): actions,
 * ships (never argo: its inbox is under Go to) and pages.
 */
export type PaletteItem =
  | { kind: 'action'; id: 'commission' | 'compose'; label: string }
  | { kind: 'page'; id: 'overview' | 'inbox' | 'attention'; label: string; href: string }
  | { kind: 'ship'; id: ShipId; name: string; type: string; status: ShipStatus; href: string };

export interface PaletteGroup {
  key: 'actions' | 'ships' | 'pages';
  label: string;
  items: PaletteItem[];
}

/** Ships shown before the operator types: the first few, so the other groups stay in view. */
export const SHIPS_BEFORE_QUERY = 8;

/** Whether the item matches the query: its label, or a ship's name or type, in any case. */
function matches(item: PaletteItem, query: string): boolean {
  const words = item.kind === 'ship' ? [item.name, item.type] : [item.label];
  return words.some((word) => word.toLowerCase().includes(query));
}

/**
 * The groups to show for a query, in the design's order (Actions, Ships, Go
 * to), each without the items that do not match; a group left empty is left
 * out. With no query every item shows, ships capped at the first few.
 */
export function paletteGroups(items: readonly PaletteItem[], query: string): PaletteGroup[] {
  const wanted = query.trim().toLowerCase();
  const kept = items.filter((item) => wanted === '' || matches(item, wanted));
  const ships = kept.filter((item) => item.kind === 'ship');
  const groups: PaletteGroup[] = [
    { key: 'actions', label: 'Actions', items: kept.filter((item) => item.kind === 'action') },
    { key: 'ships', label: 'Ships', items: wanted === '' ? ships.slice(0, SHIPS_BEFORE_QUERY) : ships },
    { key: 'pages', label: 'Go to', items: kept.filter((item) => item.kind === 'page') },
  ];
  return groups.filter((group) => group.items.length > 0);
}

/** The key an item goes by in the list: its kind and id, unique across groups. */
export function paletteKeyOf(item: PaletteItem): string {
  return `${item.kind}:${item.id}`;
}

/**
 * Everything the palette offers on a console page: the two actions, the
 * active agent ships by name (never argo, never a retired one) and the pages.
 */
export function paletteItemsOf(fleet: readonly ListedShip[]): PaletteItem[] {
  return [
    { kind: 'action', id: 'commission', label: 'Commission ship' },
    { kind: 'action', id: 'compose', label: 'Compose a message' },
    ...fleet
      .filter((ship) => ship.kind === 'agent' && ship.status !== 'retired')
      .map(
        (ship): PaletteItem => ({
          kind: 'ship',
          id: ship.id,
          name: ship.name,
          type: ship.type,
          status: ship.status,
          href: `/ships/${ship.id}`,
        }),
      ),
    { kind: 'page', id: 'overview', label: 'Fleet overview', href: '/' },
    { kind: 'page', id: 'inbox', label: 'Operator inbox', href: '/inbox' },
    { kind: 'page', id: 'attention', label: 'Needs attention', href: '/needs-attention' },
  ];
}
