import type { IdGenerator, ShipId } from '@aeolus-fleet/common';

import { revokeShipSecret, type CredentialTx } from '../identity/public.js';
import type { Caller } from '../shared/caller.js';
import type { Clock } from '../shared/clock.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { recordEvent, shipActor } from '../shared/events.js';
import { ok, type Result } from '../shared/result.js';
import type { UnitOfWork } from '../shared/unit-of-work.js';
import { removeClearRequestsOf } from './clear-request.js';
import { removeCrewRequest } from './crew-request.js';
import { retireLabelsWith } from './label.js';
import { endLease, type LeaseTx } from './leases.js';
import { withdrawWithRetiredShip } from './declared-network-rules.js';
import { unregisterNetworkPlugin } from './network-settings.js';
import type { ClearRequestRepository, CrewRequestRepository, DeclaredNetworkRulesRepository, LabelRepository, NetworkSettingsRepository, ShipRepository } from './ports.js';
import { checkCanRetire, type RetireRefusal } from './ship.js';

export interface RetireShipTx extends LeaseTx, CredentialTx {
  ships: ShipRepository;
  crewRequests: CrewRequestRepository;
  clearRequests: ClearRequestRepository;
  labels: LabelRepository;
  networkSettings: Pick<NetworkSettingsRepository, 'findForUpdate' | 'save'>;
  declaredNetworkRules: Pick<DeclaredNetworkRulesRepository, 'find' | 'save'>;
}

export type RetireShipRefusal = DomainError<'SHIP_NOT_FOUND'> | RetireRefusal;

export type RetireShip = (
  caller: Caller,
  input: { shipId: ShipId },
) => Promise<Result<{ abandonedDeliveries: number }, RetireShipRefusal>>;

/**
 * Use case: the caller retires a ship of its fleet for good (Retire): any ship
 * but argo, crewed or not. In one unit of work: its secret stops working; a
 * crewed ship's lease ends as a release ends it, so its crew token stops
 * working and what it held in flight returns to pending; then its direct
 * pending deliveries are abandoned, one DeliveryAbandoned each, and the ship
 * is retired: never claimed or addressed again, its name free. Deliveries to
 * its type stay for the other ships of the type, and an undeliverable one
 * stays for the operator. Its crew request, if any, goes with
 * CrewRequestRemoved: no one crews a retired ship. The labels it carries go,
 * and the labels it owns retire with it, each locked first and every
 * assignment of it gone first (decision 0031). A retired trierarch clears
 * nothing: its pending clear requests go, one WorktreeClearRemoved each
 * (decision 0032). The network rules it declared go with its labels
 * (decision 0037). A retired networking plugin unregisters, its rules going
 * with it: all-to-all (decision 0035). The caller's scope (fleet:manage) is
 * checked before this runs.
 *
 * It locks the ship first, as a release does (FOR NO KEY UPDATE). A send to
 * the ship holds it FOR SHARE while it resolves the selector, so the two
 * serialise: a send that commits first has its delivery abandoned here, and a
 * send after finds the ship retired and is refused. Then it holds the
 * network settings exclusively, after the ship as every send takes them.
 */
export function createRetireShip(deps: {
  uow: UnitOfWork<RetireShipTx>;
  clock: Clock;
  ids: IdGenerator;
}): RetireShip {
  return (caller, { shipId }) =>
    deps.uow.run(async (tx): Promise<Result<{ abandonedDeliveries: number }, RetireShipRefusal>> => {
      const { fleetId } = caller;
      const ship = await tx.ships.findForUpdate(fleetId, shipId);
      if (!ship) {
        return refuse('SHIP_NOT_FOUND', `Ship ${shipId} does not exist`);
      }
      const retirable = checkCanRetire(ship);
      if (!retirable.isOk) {
        return retirable;
      }
      const actor = shipActor(caller.shipId);
      const at = deps.clock.now();
      const recorded = { events: tx.events, ids: deps.ids };

      await revokeShipSecret({ tx, ids: deps.ids }, { fleetId, shipId, actor, at });
      const lease = await tx.leases.findOpenForUpdate(fleetId, shipId);
      if (lease) {
        await endLease({ tx, ids: deps.ids }, { fleetId, leaseId: lease.id, actor, at, reason: 'retired' });
      }
      const abandoned = await tx.inFlightDeliveries.abandonPendingTo(fleetId, shipId);
      await tx.ships.retire({ fleetId, shipId, at });

      await recordEvent(recorded, {
        fleetId,
        type: 'ShipRetired',
        occurredAt: at,
        actor,
        shipId,
        details: { abandonedDeliveries: abandoned.length },
      });
      for (const { deliveryId, messageId } of abandoned) {
        await recordEvent(recorded, { fleetId, type: 'DeliveryAbandoned', occurredAt: at, actor, shipId, messageId, deliveryId });
      }
      // A ship without a crew request has none to remove: nothing to do.
      const removed = removeCrewRequest({ ship, current: await tx.crewRequests.find(fleetId, shipId) }, { at, actor });
      if (removed.isOk) {
        await tx.crewRequests.remove(fleetId, shipId);
        for (const event of removed.value.events) {
          await recordEvent(recorded, event);
        }
      }
      const clearRequests = await tx.clearRequests.listFor(fleetId, shipId);
      for (const request of clearRequests) {
        await tx.clearRequests.remove(fleetId, request);
      }
      for (const event of removeClearRequestsOf({ trierarch: ship, requests: clearRequests }, { at, actor })) {
        await recordEvent(recorded, event);
      }
      const owned = await Promise.all(
        (await tx.labels.listOwnedByForUpdate(fleetId, shipId)).map(async (label) => ({ label, carriers: await tx.labels.carriersOf(fleetId, label.id) })),
      );
      const carried = await Promise.all(
        (await tx.labels.carriedBy(fleetId, shipId)).map(async (assignment) => ({ label: await tx.labels.find(fleetId, assignment.labelId), assignment })),
      );
      const labels = retireLabelsWith(
        { owned, carried: carried.flatMap(({ label, assignment }) => (label ? [{ label, assignment }] : [])) },
        { at, actor },
      );
      for (const assignment of labels.unassigned) {
        await tx.labels.unassign(assignment);
      }
      for (const label of labels.retired) {
        await tx.labels.remove(fleetId, label.id);
      }
      for (const event of labels.events) {
        await recordEvent(recorded, event);
      }
      const withdrawn = withdrawWithRetiredShip(await tx.declaredNetworkRules.find(fleetId, shipId), { at, actor });
      if (withdrawn !== undefined) {
        await tx.declaredNetworkRules.save(withdrawn.declared);
        for (const event of withdrawn.events) {
          await recordEvent(recorded, event);
        }
      }
      // Any ship but the fleet's networking plugin leaves the settings as they are.
      const unregistered = unregisterNetworkPlugin(await tx.networkSettings.findForUpdate(fleetId), { shipId, at, actor });
      if (unregistered.isOk) {
        await tx.networkSettings.save(unregistered.value.settings);
        for (const event of unregistered.value.events) {
          await recordEvent(recorded, event);
        }
      }
      return ok({ abandonedDeliveries: abandoned.length });
    });
}
