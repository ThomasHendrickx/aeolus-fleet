import type { ListedShip, ShipId, ShipStatus } from '@aeolus-fleet/common';

import type { Access } from './access';
import type { Squadron, SquadronState } from './squadrons-api';
import { blueprintPath, type BlueprintChoice } from './squadrons-view';

/**
 * What the CommandPalette offers (docs/design/png/CommandPalette.png): actions,
 * ships (never argo: its inbox is under Go to) and pages; with squadrons on,
 * Form squadron, the squadrons with their state, the blueprints and the
 * Squadrons page.
 */
export type PaletteItem =
  | { kind: 'action'; id: 'commission' | 'compose' | 'form-squadron'; label: string }
  | { kind: 'page'; id: 'overview' | 'squadrons' | 'inbox' | 'attention'; label: string; href: string }
  | { kind: 'ship'; id: ShipId; name: string; type: string; status: ShipStatus; href: string }
  | { kind: 'squadron'; id: string; blueprint: string; state: SquadronState; href: string }
  | { kind: 'blueprint'; id: string; name: string; version: number; href: string };

export interface PaletteGroup {
  key: 'actions' | 'ships' | 'squadrons' | 'blueprints' | 'pages';
  label: string;
  items: PaletteItem[];
}

/** Ships shown before the operator types: the first few, so the other groups stay in view. */
export const SHIPS_BEFORE_QUERY = 8;

/** Whether the item matches the query: its label, or a ship's name or type, in any case. */
function matches(item: PaletteItem, query: string): boolean {
  const words =
    item.kind === 'ship' ? [item.name, item.type] : item.kind === 'squadron' ? [item.id, item.blueprint] : item.kind === 'blueprint' ? [item.name] : [item.label];
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
    { key: 'squadrons', label: 'Squadrons', items: kept.filter((item) => item.kind === 'squadron') },
    { key: 'blueprints', label: 'Blueprints', items: kept.filter((item) => item.kind === 'blueprint') },
    { key: 'pages', label: 'Go to', items: kept.filter((item) => item.kind === 'page') },
  ];
  return groups.filter((group) => group.items.length > 0);
}

/** What each action needs the console session to hold: Compose sends, Commission ship and Form squadron manage the fleet. */
const ACTION_NEEDS = { compose: 'canSend', commission: 'canManage', 'form-squadron': 'canManage' } as const;

/**
 * The items the console session may use: every ship, squadron, blueprint and
 * page, and only the actions it holds the scope for, so a viewer's palette
 * searches and goes to, and offers no action (lib/access).
 */
export function allowedPaletteItems(items: readonly PaletteItem[], access: Pick<Access, 'canManage' | 'canSend'>): PaletteItem[] {
  return items.filter((item) => item.kind !== 'action' || access[ACTION_NEEDS[item.id]]);
}

/** The key an item goes by in the list: its kind and id, unique across groups. */
export function paletteKeyOf(item: PaletteItem): string {
  return `${item.kind}:${item.id}`;
}

/**
 * Everything the palette offers on a console page: the actions, the active
 * agent ships by name (never argo, never a retired one) and the pages; with
 * squadrons on, also Form squadron, the squadrons not disbanded, the
 * blueprints at their latest version and the Squadrons page.
 */
export function paletteItemsOf(
  fleet: readonly ListedShip[],
  squadrons?: { squadrons: readonly Pick<Squadron, 'id' | 'state' | 'blueprint'>[]; blueprints: readonly BlueprintChoice[] },
): PaletteItem[] {
  return [
    { kind: 'action', id: 'commission', label: 'Commission ship' },
    ...(squadrons ? [{ kind: 'action', id: 'form-squadron', label: 'Form squadron' } satisfies PaletteItem] : []),
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
    ...(squadrons?.squadrons ?? [])
      .filter((squadron) => squadron.state !== 'disbanded')
      .map((squadron): PaletteItem => ({ kind: 'squadron', id: squadron.id, blueprint: squadron.blueprint.name, state: squadron.state, href: `/squadrons/${squadron.id}` })),
    ...(squadrons?.blueprints ?? []).map(
      (blueprint): PaletteItem => ({ kind: 'blueprint', id: blueprint.key, name: blueprint.name, version: blueprint.versions[0]?.version ?? 0, href: blueprintPath(blueprint) }),
    ),
    { kind: 'page', id: 'overview', label: 'Fleet overview', href: '/' },
    ...(squadrons ? [{ kind: 'page', id: 'squadrons', label: 'Squadrons', href: '/squadrons' } satisfies PaletteItem] : []),
    { kind: 'page', id: 'inbox', label: 'Operator inbox', href: '/inbox' },
    { kind: 'page', id: 'attention', label: 'Needs attention', href: '/needs-attention' },
  ];
}
