import type { ListedShip, LocationKind } from '@aeolus-fleet/common';

const KIND_WORDS: Record<LocationKind, string> = {
  DEVICE: 'Device',
  CLOUD: 'Cloud',
  SERVER: 'Server',
  OTHER: 'Other',
};

/** A location kind as the console words it: Device, Cloud, Server or Other. */
export function locationKindWord(kind: LocationKind): string {
  return KIND_WORDS[kind];
}

/**
 * Where the session crewing a ship runs, as the console words it:
 * `<Kind> · <description>` (docs/design/conventions.md, "Copy"). Only OTHER
 * carries a description. Null while no session crews the ship.
 */
export function locationText(ship: Pick<ListedShip, 'location'>): string | null {
  const { location } = ship;
  if (location === null) {
    return null;
  }
  const kind = KIND_WORDS[location.kind];
  return location.description === null ? kind : `${kind} · ${location.description}`;
}
