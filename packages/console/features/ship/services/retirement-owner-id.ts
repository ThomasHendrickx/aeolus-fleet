import type { ShipId, TimelineEntry } from '@aeolus-fleet/common';

/** The recorded new owner a retirement timeline row must name, never its actor. */
export function retirementOwnerId(entry: TimelineEntry): ShipId | undefined {
  const id = entry.details.toShipId;
  return entry.type === 'OwnerChanged' && entry.details.why === 'ownerRetired' && isShipId(id) ? id : undefined;
}

function isShipId(value: unknown): value is ShipId {
  return typeof value === 'string' && /^shp_[0-7][0-9a-hjkmnp-tv-z]{25}$/.test(value);
}
