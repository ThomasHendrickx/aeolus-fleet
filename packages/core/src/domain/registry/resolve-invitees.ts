import type { FleetId, LabelValueId, ShipId } from '@aeolus-fleet/common';

import { ok, type Result } from '../shared/result.js';
import type { ShipRepository } from './ports.js';
import { resolveSelector, type ResolveSelectorTx, type UnresolvableSelector } from './resolve-selector.js';

/** The ports resolving a meeting's invitees reads, inside the caller's unit of work. */
export interface ResolveInviteesTx {
  ships: ResolveSelectorTx['ships'] & Pick<ShipRepository, 'listActiveCarryingEvery'>;
}

/** One ship invited by its id or by its name; never a type (decision 0061). */
export type Invitee = { shipId: ShipId } | { name: string };

/**
 * The ships a meeting's invitees name (decision 0061): each ship by id or by
 * name, resolved as a send's ship selector is, then the ships a label
 * selection resolves to, carrying every value, never the viewer ship. Each is
 * held as a send holds the ship it addresses, so a retire waits for the open.
 * A ship named twice comes once, where it first came; an unknown, retired or
 * viewer ship named in the list refuses all of it.
 */
export async function resolveInvitees(
  tx: ResolveInviteesTx,
  input: { fleetId: FleetId; ships: readonly Invitee[]; valueIds: readonly LabelValueId[] },
): Promise<Result<ShipId[], UnresolvableSelector>> {
  const { fleetId } = input;
  const selected = input.valueIds.length === 0 ? [] : await tx.ships.listActiveCarryingEvery(fleetId, input.valueIds);
  const invitees: Invitee[] = [...input.ships, ...selected.map((ship) => ({ shipId: ship.id }))];
  const resolved: ShipId[] = [];
  for (const invitee of invitees) {
    const recipient = await resolveSelector(tx, { fleetId, selector: { kind: 'ship', ...invitee } });
    if (!recipient.isOk) {
      return recipient;
    }
    if (recipient.value.kind === 'ship' && !resolved.includes(recipient.value.shipId)) {
      resolved.push(recipient.value.shipId);
    }
  }
  return ok(resolved);
}
