import type { IdGenerator, ShipId } from '@aeolus-fleet/common';

import { revokeShipSecret, type CredentialTx } from '../identity/public.js';
import { leaveMeetingsOnRetire, lockMeetingsOf, type AcceptRefusal, type RequestHasher, type RetiredParticipantTx } from '../messaging/public.js';
import { actorOf, type Caller } from '../shared/caller.js';
import type { Clock } from '../shared/clock.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { recordEvent } from '../shared/events.js';
import { ok, type Result } from '../shared/result.js';
import type { UnitOfWork } from '../shared/unit-of-work.js';
import { checkManage, keepingReachRefusal, type CheckManageTx, type NotReachable } from './check-reach.js';
import { removeClearRequestsOf } from './clear-request.js';
import { removeCrewRequest } from './crew-request.js';
import { retireLabelsWith } from './label.js';
import { endLease, type LeaseTx } from './leases.js';
import { withdrawWithRetiredShip } from './declared-network-rules.js';
import type { ClearRequestRepository, CrewRequestRepository, DeclaredNetworkRulesRepository, LabelRepository, NetworkSettingsRepository, ScopeNamespaceRepository, ShipRepository, VerifiedFactsRepository } from './ports.js';
import { changeOwner, checkCanRetire, type RetireRefusal } from './ship.js';
import { releaseWithDeclarer } from './scope-namespace.js';
import { removeWithRetiredShip } from './verified-facts.js';

export interface RetireShipTx extends LeaseTx, CredentialTx, RetiredParticipantTx, Omit<CheckManageTx, 'ships' | 'labels' | 'networkSettings' | 'declaredNetworkRules' | 'events'> {
  ships: ShipRepository;
  crewRequests: CrewRequestRepository;
  clearRequests: ClearRequestRepository;
  labels: LabelRepository;
  networkSettings: Pick<NetworkSettingsRepository, 'find' | 'findForShare' | 'findForUpdate' | 'save'>;
  declaredNetworkRules: Pick<DeclaredNetworkRulesRepository, 'list' | 'find' | 'save'>;
  scopeNamespaces: Pick<ScopeNamespaceRepository, 'findByDeclarer' | 'lockNamespace' | 'remove'>;
  verifiedFacts: Pick<VerifiedFactsRepository, 'listAbout' | 'listBy' | 'lockWriter' | 'remove'>;
}

export type RetireShipRefusal = DomainError<'SHIP_NOT_FOUND'> | NotReachable | RetireRefusal | AcceptRefusal;

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
 * (decision 0032). The network rules it declared go with its labels, the
 * settings at their next version (decision 0037). Each active ship it owned
 * falls to argo, one OwnerChanged each, locked after the ship as a set owner
 * locks the owner first (decision 0045). A plugin namespace it declared goes,
 * and its scopes leave every ship, one ScopesChanged each (decision 0046).
 * A plugin ship's read ends, with PluginDisconnected (decision 0050).
 * Every writer's verified facts about it go, and its own about every ship,
 * one VerifiedFactsRemoved each, under its writer lock, taken last, after
 * every ship this locks, as a set takes it after the ship it writes about
 * (decision 0059). It leaves every open meeting it is present in, off the
 * mic, its moderatorship going to the owner, and a meeting it owns ends, the
 * others told (decision 0061, M15, M17): those meetings it locks before the
 * ship, as a contribution locks its meeting before its recipients.
 * The caller, any actor (decision 0057), needs fleet:manage, checked before
 * this runs, and manage reach on the ship here (decision 0034), a refusal
 * storing only its record. That check reads the network
 * settings without a lock: retire takes them exclusively later, after the
 * ships it owns, and a shared hold taken first would deadlock two retires.
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
  hasher: RequestHasher;
}): RetireShip {
  return (caller, { shipId }) =>
    keepingReachRefusal(deps.uow, async (tx): Promise<Result<{ abandonedDeliveries: number }, RetireShipRefusal>> => {
      const { fleetId } = caller;
      const meetings = await lockMeetingsOf(tx, { fleetId, shipId });
      const ship = await tx.ships.findForUpdate(fleetId, shipId);
      if (!ship) {
        return refuse('SHIP_NOT_FOUND', `Ship ${shipId} does not exist`);
      }
      const managed = await checkManage(
        { tx, ids: deps.ids },
        { manager: caller, shipId, at: deps.clock.now(), settings: await tx.networkSettings.find(fleetId) },
      );
      if (!managed.isOk) {
        return managed;
      }
      const retirable = checkCanRetire(ship);
      if (!retirable.isOk) {
        return retirable;
      }
      const actor = actorOf(caller);
      const at = deps.clock.now();
      const recorded = { events: tx.events, ids: deps.ids };

      await revokeShipSecret({ tx, ids: deps.ids }, { fleetId, shipId, actor, at });
      const lease = await tx.leases.findOpenForUpdate(fleetId, shipId);
      if (lease) {
        await endLease({ tx, ids: deps.ids }, { fleetId, leaseId: lease.id, actor, at, reason: 'retired' });
      }
      const abandoned = await tx.inFlightDeliveries.abandonPendingTo(fleetId, shipId);
      await tx.ships.retire({ fleetId, shipId, at });
      if (ship.kind === 'plugin') {
        // A plugin ship reads every ship until it retires (decision 0050).
        await recordEvent(recorded, { fleetId, type: 'PluginDisconnected', occurredAt: at, actor, shipId, details: { why: 'retired' } });
      }

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
      const argo = await tx.ships.findOperatorShip(fleetId);
      for (const ownedShip of await tx.ships.listActiveOwnedByForUpdate(fleetId, shipId)) {
        // Never refused: an owned ship is active and never argo's own, and argo is always active.
        const changed = changeOwner(ownedShip, { owner: argo, why: 'ownerRetired', at, actor });
        if (changed.isOk && changed.value.ship.owner !== null && changed.value.ship.owner !== ownedShip.owner) {
          await tx.ships.setOwner({ fleetId, shipId: ownedShip.id, ownerShipId: changed.value.ship.owner });
          for (const event of changed.value.events) {
            await recordEvent(recorded, event);
          }
        }
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
      // A ship that declared no rules leaves the settings as they are.
      const settings = await tx.networkSettings.findForUpdate(fleetId);
      const withdrawn = withdrawWithRetiredShip(await tx.declaredNetworkRules.find(fleetId, { kind: 'ship', shipId }), { settings, at, actor });
      if (withdrawn !== undefined) {
        await tx.declaredNetworkRules.save(withdrawn.declared);
        await tx.networkSettings.save(withdrawn.settings);
        for (const event of withdrawn.events) {
          await recordEvent(recorded, event);
        }
      }
      const declared = await tx.scopeNamespaces.findByDeclarer(fleetId, shipId);
      if (declared !== undefined) {
        // The holders first, as every grant locks its ship before the
        // namespace; then the namespace, so no grant of its scopes commits
        // in between; then the holders again: a grant that did commit before
        // the namespace lock holds no lock any more.
        await tx.ships.listActiveHoldingInForUpdate(fleetId, declared.namespace);
        await tx.scopeNamespaces.lockNamespace(fleetId, declared.namespace);
        const released = releaseWithDeclarer(declared, { holders: await tx.ships.listActiveHoldingInForUpdate(fleetId, declared.namespace), at, actor });
        for (const changed of released.ships) {
          await tx.ships.setScopes({ fleetId, shipId: changed.id, scopes: changed.scopes });
        }
        await tx.scopeNamespaces.remove(fleetId, declared.namespace);
        for (const event of released.events) {
          await recordEvent(recorded, event);
        }
      }
      const left = await leaveMeetingsOnRetire({ tx, ids: deps.ids, hasher: deps.hasher }, { meetings, shipId, actor, at });
      if (!left.isOk) {
        return left;
      }
      await tx.verifiedFacts.lockWriter(fleetId, shipId);
      const facts = removeWithRetiredShip({ about: await tx.verifiedFacts.listAbout(fleetId, shipId), by: await tx.verifiedFacts.listBy(fleetId, shipId) }, { at, actor });
      for (const written of facts.removed) {
        await tx.verifiedFacts.remove(fleetId, { shipId: written.shipId, writer: written.writer });
      }
      for (const event of facts.events) {
        await recordEvent(recorded, event);
      }
      return ok({ abandonedDeliveries: abandoned.length });
    });
}
