import { createIdGenerator, idSchema, PING_CONTENT_TYPE, type FleetId, type IdGenerator, type ShipId } from '@aeolus-fleet/common';

import type { ConsoleSession } from '../../src/core/identity/console-session.js';
import type { Credential } from '../../src/core/identity/credential.js';
import type { OperatorAccount } from '../../src/core/identity/operator-account.js';
import type {
  AuthenticatedShip,
  CallerLookup,
  ConsoleSessionRepository,
  CredentialRepository,
  OperatorAccountLookup,
  OperatorAccountRepository,
} from '../../src/core/identity/ports.js';
import type { Delivery, Message } from '../../src/core/messaging/message.js';
import type {
  DeliveryRepository,
  MessageRepository,
  ReceiverAddress,
  ReceiverWakeups,
} from '../../src/core/messaging/ports.js';
import type { Fleet } from '../../src/core/registry/fleet.js';
import type { InstallationRequest } from '../../src/core/registry/installation-request.js';
import type { Lease } from '../../src/core/registry/lease.js';
import type {
  FleetListing,
  ShipFacts,
  FleetRepository,
  InFlightDeliveries,
  InstallationRequestRepository,
  LeaseRepository,
  ShipRepository,
} from '../../src/core/registry/ports.js';
import type { Ship } from '../../src/core/registry/ship.js';
import type { ShipReport } from '../../src/core/registry/ship-report.js';
import type { Clock } from '../../src/core/shared/clock.js';
import type { EventLog, FleetEvent, FleetEventFeed, SequencedEvent } from '../../src/core/shared/events.js';
import {
  isDeliveryChangeType,
  isKeptBy,
  type DeliveryChange,
  type HistoryMessage,
  type HistoryParty,
  type HistoryRecipient,
  type ShipHistory,
  type TimelineEntry,
} from '../../src/core/shared/history.js';
import type { Recipient } from '../../src/core/shared/selector.js';
import type { DeliveryNotice, Notifier } from '../../src/core/shared/notifier.js';
import type { PasswordHasher, RandomTokens, SecretHasher } from '../../src/core/shared/secrets.js';
import type { UnitOfWork } from '../../src/core/shared/unit-of-work.js';

/**
 * In-memory ports for unit tests of the core. Every repository reads and writes
 * one plain state object; the unit of work restores it when the work refuses or
 * throws, so tests can prove a use case leaves nothing behind.
 */

export interface InMemoryState {
  fleets: Fleet[];
  ships: Ship[];
  leases: Lease[];
  credentials: Credential[];
  operatorAccounts: OperatorAccount[];
  consoleSessions: ConsoleSession[];
  messages: Message[];
  deliveries: Delivery[];
  /** When each lease was last seen through a call by its crew: the last_seen_at column, apart from the Lease. */
  leaseSeen: { fleetId: FleetId; leaseId: Lease['id']; at: Date }[];
  /** Each lease's crew report: the report columns, apart from the Lease. */
  leaseReports: { fleetId: FleetId; leaseId: Lease['id']; report: ShipReport }[];
  /** When the recipient read each delivery it read: the read_at column, apart from the Delivery's state. */
  deliveryReads: { fleetId: FleetId; deliveryId: Delivery['id']; readAt: Date }[];
  events: FleetEvent[];
  /** The installation's requests: the one table without a fleet (decision 0020). */
  installationRequests: InstallationRequest[];
  /** The notices a unit of work sent: gone again when it rolls back, as Postgres drops a NOTIFY. */
  notices: DeliveryNotice[];
}

export interface InMemoryTx {
  fleets: FleetRepository;
  ships: ShipRepository;
  leases: LeaseRepository;
  inFlightDeliveries: InFlightDeliveries;
  credentials: CredentialRepository;
  operatorAccounts: OperatorAccountRepository;
  consoleSessions: ConsoleSessionRepository;
  messages: MessageRepository;
  deliveries: DeliveryRepository;
  events: EventLog;
  notifier: Notifier;
  installationRequests: InstallationRequestRepository;
}

/**
 * Wake-ups for a waiting receive, played by the test. A wait takes the next
 * scripted step, which may send a message or move the clock and says whether
 * it woke the receive; without one, the whole wait passes on the clock and
 * times out.
 */
export interface InMemoryWakeups extends ReceiverWakeups {
  /** Every ship and type a receive watched, in order. */
  watched: ReceiverAddress[];
  /** Every wait a receive began, in milliseconds. */
  waits: number[];
  /** What the next waits do, first one first. */
  nextWaits: (() => Promise<'woken' | 'timedOut'>)[];
  /** How many watches have not stopped. */
  watching(): number;
}

export interface InMemoryCore {
  state: InMemoryState;
  uow: UnitOfWork<InMemoryTx>;
  /** The ships, read outside a unit of work. */
  ships: ShipRepository;
  callers: CallerLookup;
  accounts: OperatorAccountLookup;
  listing: FleetListing;
  /** The committed events, numbered per fleet in the order they were appended. */
  feed: FleetEventFeed;
  /** The history reads for the ship page, from the events, messages and deliveries held. */
  history: ShipHistory;
  clock: Clock & { set(iso: string | Date): void; advance(ms: number): void };
  ids: IdGenerator;
  hasher: SecretHasher;
  passwords: PasswordHasher;
  random: RandomTokens;
  wakeups: InMemoryWakeups;
}

/** Oldest first, as Postgres orders them: by creation, then by id. */
function byAge(first: Delivery, second: Delivery): number {
  return first.createdAt.getTime() - second.createdAt.getTime() || first.id.localeCompare(second.id);
}

export function createInMemoryCore(startAt = '2026-09-29T12:00:00.000Z'): InMemoryCore {
  const state: InMemoryState = {
    fleets: [],
    ships: [],
    leases: [],
    credentials: [],
    operatorAccounts: [],
    consoleSessions: [],
    messages: [],
    deliveries: [],
    deliveryReads: [],
    leaseSeen: [],
    leaseReports: [],
    events: [],
    installationRequests: [],
    notices: [],
  };

  let now = new Date(startAt);
  const clock = {
    now: () => new Date(now),
    set: (iso: string | Date) => {
      now = new Date(iso);
    },
    advance: (ms: number) => {
      now = new Date(now.getTime() + ms);
    },
  };

  const ids = createIdGenerator({ now: () => now.getTime() });

  let tokenCount = 0;
  const random: RandomTokens = {
    next: () => {
      tokenCount += 1;
      return `random-${String(tokenCount)}`;
    },
  };
  const hasher: SecretHasher = { hash: (value) => `sha256(${value})` };
  const passwords: PasswordHasher = {
    hash: (password) => Promise.resolve(`argon2id(${password})`),
    verify: (password, passwordHash) => Promise.resolve(passwordHash === `argon2id(${password})`),
  };

  const ship = (fleetId: FleetId, shipId: ShipId): Ship | undefined =>
    state.ships.find((candidate) => candidate.fleetId === fleetId && candidate.id === shipId);

  const authenticated = (found: Ship): AuthenticatedShip => ({
    shipId: found.id,
    fleetId: found.fleetId,
    kind: found.kind,
    scopes: found.scopes,
  });

  const tx: InMemoryTx = {
    fleets: {
      lockInitialisation: () => Promise.resolve(),
      count: () => Promise.resolve(state.fleets.length),
      list: () => Promise.resolve(state.fleets.map((fleet) => ({ ...fleet }))),
      create: (fleet) => {
        state.fleets.push({ ...fleet });
        return Promise.resolve();
      },
      findForUpdate: (fleetId) => {
        const fleet = state.fleets.find((held) => held.id === fleetId);
        return Promise.resolve(fleet && { ...fleet });
      },
      delete: (fleetId) => {
        // Every table that belongs to a fleet, as the Postgres adapter deletes them.
        state.fleets.splice(0, state.fleets.length, ...state.fleets.filter((fleet) => fleet.id !== fleetId));
        for (const table of FLEET_TABLES) {
          const rows: { fleetId: FleetId }[] = state[table];
          rows.splice(0, rows.length, ...rows.filter((row) => row.fleetId !== fleetId));
        }
        return Promise.resolve();
      },
    },
    ships: {
      create: (created) => {
        if (
          state.ships.some(
            (held) => held.fleetId === created.fleetId && held.name === created.name && held.retiredAt === null,
          )
        ) {
          return Promise.reject(new Error('unique violation: an active ship of the fleet already has this name'));
        }
        state.ships.push({ ...created });
        return Promise.resolve();
      },
      findOperatorShip: (fleetId) =>
        Promise.resolve(state.ships.find((found) => found.fleetId === fleetId && found.kind === 'operator')),
      lockName: () => Promise.resolve(),
      lockCommissionKey: () => Promise.resolve(),
      findByCommissionKey: ({ fleetId, by, idempotencyKey }) =>
        Promise.resolve(
          state.ships.find(
            (found) => found.fleetId === fleetId && found.commission?.by === by && found.commission.idempotencyKey === idempotencyKey,
          ),
        ),
      findActiveByName: (fleetId, name) =>
        Promise.resolve(
          state.ships.find((found) => found.fleetId === fleetId && found.name === name && found.retiredAt === null),
        ),
      find: (fleetId, shipId) => {
        const found = ship(fleetId, shipId);
        return Promise.resolve(found && { ...found });
      },
      rename: ({ fleetId, shipId, name }) => {
        const found = ship(fleetId, shipId);
        if (found) {
          found.name = name;
        }
        return Promise.resolve();
      },
      retire: ({ fleetId, shipId, at }) => {
        const found = state.ships.find((held) => held.fleetId === fleetId && held.id === shipId);
        if (!found) {
          return Promise.reject(new Error(`no ship ${shipId} to retire`));
        }
        found.retiredAt = at;
        return Promise.resolve();
      },
      findForUpdate: (fleetId, shipId) => Promise.resolve(ship(fleetId, shipId)),
      findForShare: (fleetId, shipId) => {
        const found = ship(fleetId, shipId);
        return Promise.resolve(found && { ...found });
      },
      findActiveByNameForShare: (fleetId, name) => {
        const found = state.ships.find((held) => held.fleetId === fleetId && held.name === name && held.retiredAt === null);
        return Promise.resolve(found && { ...found });
      },
      hasActiveShipOfType: (fleetId, type) =>
        Promise.resolve(
          state.ships.some((held) => held.fleetId === fleetId && held.type === type && held.retiredAt === null),
        ),
    },
    leases: {
      findOpenForUpdate: (fleetId, shipId) =>
        Promise.resolve(
          state.leases.find((lease) => lease.fleetId === fleetId && lease.shipId === shipId && lease.endedAt === null),
        ),
      open: (lease) => {
        if (state.leases.some((held) => held.shipId === lease.shipId && held.endedAt === null)) {
          return Promise.reject(new Error('unique violation: the ship already holds an open lease'));
        }
        state.leases.push({ ...lease });
        return Promise.resolve();
      },
      findOpenForShare: (fleetId, shipId) => {
        const lease = state.leases.find(
          (held) => held.fleetId === fleetId && held.shipId === shipId && held.endedAt === null,
        );
        return Promise.resolve(lease && { ...lease });
      },
      markSeen: ({ fleetId, leaseId, at }) => {
        const seen = state.leaseSeen.find((held) => held.fleetId === fleetId && held.leaseId === leaseId);
        if (!seen) {
          state.leaseSeen.push({ fleetId, leaseId, at });
        } else if (seen.at < at) {
          seen.at = at;
        }
        return Promise.resolve();
      },
      findReportForUpdate: (fleetId, leaseId) => {
        const isOpen = state.leases.some((held) => held.fleetId === fleetId && held.id === leaseId && held.endedAt === null);
        const held = state.leaseReports.find((each) => each.fleetId === fleetId && each.leaseId === leaseId);
        return Promise.resolve(isOpen ? { report: held ? { ...held.report } : null } : undefined);
      },
      saveReport: ({ fleetId, leaseId, report }) => {
        const held = state.leaseReports.find((each) => each.fleetId === fleetId && each.leaseId === leaseId);
        if (held) {
          held.report = { ...report };
        } else {
          state.leaseReports.push({ fleetId, leaseId, report: { ...report } });
        }
        return Promise.resolve();
      },
      findOpenByIdForShare: (fleetId, leaseId) => {
        const lease = state.leases.find(
          (held) => held.fleetId === fleetId && held.id === leaseId && held.endedAt === null,
        );
        return Promise.resolve(lease && { ...lease });
      },
      end: ({ fleetId, leaseId, endedAt }) => {
        const lease = state.leases.find((held) => held.fleetId === fleetId && held.id === leaseId);
        if (lease?.endedAt !== null) {
          return Promise.resolve(undefined);
        }
        lease.endedAt = endedAt;
        return Promise.resolve({ ...lease });
      },
    },
    inFlightDeliveries: {
      returnToPending: (fleetId, leaseId) => {
        const inFlight = state.deliveries
          .filter(
            (delivery) =>
              delivery.fleetId === fleetId && delivery.state === 'delivered' && delivery.claimedByLeaseId === leaseId,
          )
          .sort(byAge);
        for (const delivery of inFlight) {
          delivery.state = 'pending';
          delivery.claimedByShipId = null;
          delivery.claimedByLeaseId = null;
        }
        return Promise.resolve(
          inFlight.map(({ id, messageId, recipient, attempts }) => ({
            deliveryId: id,
            messageId,
            recipient: structuredClone(recipient),
            attempts,
          })),
        );
      },
      abandonPendingTo: (fleetId, shipId) => {
        const pending = state.deliveries
          .filter(
            (delivery) =>
              delivery.fleetId === fleetId &&
              delivery.state === 'pending' &&
              delivery.recipient.kind === 'ship' &&
              delivery.recipient.shipId === shipId,
          )
          .sort(byAge);
        for (const delivery of pending) {
          delivery.state = 'abandoned';
        }
        return Promise.resolve(pending.map(({ id, messageId }) => ({ deliveryId: id, messageId })));
      },
    },
    credentials: {
      create: (credential) => {
        if (state.credentials.some((held) => held.shipId === credential.shipId && held.invalidatedAt === null)) {
          return Promise.reject(new Error('unique violation: the ship already has a valid secret'));
        }
        state.credentials.push({ ...credential });
        return Promise.resolve();
      },
      findValidBySecretHashForUpdate: (secretHash) => {
        const credential = state.credentials.find(
          (held) => held.secretHash === secretHash && held.invalidatedAt === null,
        );
        return Promise.resolve(credential && { ...credential });
      },
      findValidForShipForUpdate: (fleetId, shipId) =>
        Promise.resolve(
          state.credentials.find(
            (held) => held.fleetId === fleetId && held.shipId === shipId && held.invalidatedAt === null,
          ),
        ),
      markClaimed: ({ fleetId, credentialId, at }) => {
        const credential = state.credentials.find((held) => held.fleetId === fleetId && held.id === credentialId);
        if (credential) {
          credential.claimedAt = at;
        }
        return Promise.resolve();
      },
      invalidate: ({ fleetId, credentialId, at }) => {
        const credential = state.credentials.find((held) => held.fleetId === fleetId && held.id === credentialId);
        if (credential) {
          credential.invalidatedAt = at;
        }
        return Promise.resolve();
      },
    },
    operatorAccounts: {
      // One test runs one unit of work at a time: nothing to wait for.
      lockEmail: () => Promise.resolve(),
      create: (account) => {
        if (state.operatorAccounts.some((held) => held.email === account.email || held.fleetId === account.fleetId)) {
          return Promise.reject(new Error('unique violation: the email or the fleet already has an operator account'));
        }
        state.operatorAccounts.push({ ...account });
        return Promise.resolve();
      },
      findByEmailForUpdate: (email) => {
        const account = state.operatorAccounts.find((held) => held.email === email);
        return Promise.resolve(account && { ...account });
      },
      findForFleetForUpdate: (fleetId) => {
        const account = state.operatorAccounts.find((held) => held.fleetId === fleetId);
        return Promise.resolve(account && { ...account });
      },
      findForFleet: (fleetId) => {
        const account = state.operatorAccounts.find((held) => held.fleetId === fleetId);
        return Promise.resolve(account && { ...account });
      },
      setTheme: ({ fleetId, operatorId, theme }) => {
        const account = state.operatorAccounts.find((held) => held.fleetId === fleetId && held.id === operatorId);
        if (account) {
          account.theme = theme;
        }
        return Promise.resolve();
      },
      changePassword: ({ fleetId, operatorId, passwordHash }) => {
        const account = state.operatorAccounts.find((held) => held.fleetId === fleetId && held.id === operatorId);
        if (account) {
          account.passwordHash = passwordHash;
        }
        return Promise.resolve();
      },
    },
    consoleSessions: {
      find: (fleetId, consoleSessionId) => {
        const session = state.consoleSessions.find((held) => held.fleetId === fleetId && held.id === consoleSessionId);
        return Promise.resolve(session && { ...session });
      },
      create: (session) => {
        if (state.consoleSessions.some((held) => held.fleetId === session.fleetId && held.endedAt === null)) {
          return Promise.reject(new Error('unique violation: the fleet already has a live console session'));
        }
        state.consoleSessions.push({ ...session });
        return Promise.resolve();
      },
      end: ({ fleetId, consoleSessionId, at, reason }) => {
        const session = state.consoleSessions.find((held) => held.fleetId === fleetId && held.id === consoleSessionId);
        if (session?.endedAt !== null) {
          return Promise.resolve(undefined);
        }
        session.endedAt = at;
        session.endReason = reason;
        return Promise.resolve({ ...session });
      },
      endAll: (fleetId, { at, reason }) => {
        const open = state.consoleSessions.filter((held) => held.fleetId === fleetId && held.endedAt === null);
        for (const session of open) {
          session.endedAt = at;
          session.endReason = reason;
        }
        return Promise.resolve(open.map((session) => ({ ...session })));
      },
    },
    messages: {
      create: (message) => {
        if (
          state.messages.some(
            (held) =>
              held.fleetId === message.fleetId &&
              held.senderShipId === message.senderShipId &&
              held.idempotencyKey === message.idempotencyKey,
          )
        ) {
          return Promise.reject(new Error('unique violation: the sender already used this idempotency key'));
        }
        state.messages.push(structuredClone(message));
        return Promise.resolve();
      },
      lockIdempotencyKey: () => Promise.resolve(),
      findByIdempotencyKey: ({ fleetId, senderShipId, idempotencyKey }) => {
        const found = state.messages.find(
          (held) =>
            held.fleetId === fleetId && held.senderShipId === senderShipId && held.idempotencyKey === idempotencyKey,
        );
        return Promise.resolve(found && structuredClone(found));
      },
      find: (fleetId, messageId) => {
        const found = state.messages.find((held) => held.fleetId === fleetId && held.id === messageId);
        return Promise.resolve(found && structuredClone(found));
      },
    },
    deliveries: {
      create: (delivery) => {
        state.deliveries.push(structuredClone(delivery));
        return Promise.resolve();
      },
      findClaimableForUpdate: ({ fleetId, shipId, type, leaseId, limit, excluding }) => {
        const ofFleet = state.deliveries.filter((delivery) => delivery.fleetId === fleetId);
        const inFlight = ofFleet
          .filter(
            (delivery) =>
              delivery.state === 'delivered' && delivery.claimedByLeaseId === leaseId && !excluding.includes(delivery.id),
          )
          .sort(byAge);
        const pending = ofFleet
          .filter(
            ({ state: deliveryState, recipient }) =>
              deliveryState === 'pending' &&
              ((recipient.kind === 'ship' && recipient.shipId === shipId) ||
                (recipient.kind === 'type' && recipient.type === type)),
          )
          .sort(byAge);
        const claimable = [...inFlight, ...pending].slice(0, limit).flatMap((delivery) => {
          const message = state.messages.find((held) => held.fleetId === fleetId && held.id === delivery.messageId);
          return message ? [{ delivery: structuredClone(delivery), message: structuredClone(message) }] : [];
        });
        return Promise.resolve(claimable);
      },
      countReceivable: ({ fleetId, shipId, type, leaseId }) =>
        Promise.resolve(
          state.deliveries.filter(
            (delivery) =>
              delivery.fleetId === fleetId &&
              ((delivery.state === 'delivered' && delivery.claimedByLeaseId === leaseId) ||
                (delivery.state === 'pending' &&
                  ((delivery.recipient.kind === 'ship' && delivery.recipient.shipId === shipId) ||
                    (delivery.recipient.kind === 'type' && delivery.recipient.type === type)))),
          ).length,
        ),
      findForUpdate: (fleetId, deliveryId) => {
        const found = state.deliveries.find((held) => held.fleetId === fleetId && held.id === deliveryId);
        return Promise.resolve(found && structuredClone(found));
      },
      findOpenPing: (fleetId, shipId) => {
        const open = state.deliveries.find(
          (delivery) =>
            delivery.fleetId === fleetId &&
            delivery.recipient.kind === 'ship' &&
            delivery.recipient.shipId === shipId &&
            (delivery.state === 'pending' || delivery.state === 'delivered') &&
            state.messages.some((message) => message.id === delivery.messageId && message.contentType === PING_CONTENT_TYPE),
        );
        const message = open && state.messages.find((held) => held.id === open.messageId);
        return Promise.resolve(message && structuredClone(message));
      },
      update: (delivery) => {
        const index = state.deliveries.findIndex((held) => held.fleetId === delivery.fleetId && held.id === delivery.id);
        if (index === -1) {
          return Promise.reject(new Error(`no delivery ${delivery.id} to update`));
        }
        state.deliveries[index] = structuredClone(delivery);
        return Promise.resolve();
      },
      markRead: ({ fleetId, deliveryId, at }) => {
        if (!state.deliveryReads.some((read) => read.fleetId === fleetId && read.deliveryId === deliveryId)) {
          state.deliveryReads.push({ fleetId, deliveryId, readAt: at });
        }
        return Promise.resolve();
      },
      markUnread: ({ fleetId, deliveryId }) => {
        const index = state.deliveryReads.findIndex((read) => read.fleetId === fleetId && read.deliveryId === deliveryId);
        if (index !== -1) {
          state.deliveryReads.splice(index, 1);
        }
        return Promise.resolve();
      },
    },
    events: {
      append: (event) => {
        state.events.push({ ...event });
        return Promise.resolve();
      },
    },
    installationRequests: {
      lock: () => Promise.resolve(),
      find: (requestId) => {
        const request = state.installationRequests.find((held) => held.requestId === requestId);
        return Promise.resolve(request && { ...request });
      },
      record: (request) => {
        state.installationRequests.push({ ...request });
        return Promise.resolve();
      },
    },
    notifier: {
      deliveryPending: (notice) => {
        state.notices.push(structuredClone(notice));
        return Promise.resolve();
      },
    },
  };

  // One unit of work at a time, like serialised transactions.
  let queue: Promise<unknown> = Promise.resolve();
  const uow: UnitOfWork<InMemoryTx> = {
    run: (work) => {
      const run = queue.then(async () => {
        const snapshot = structuredClone(state);
        try {
          const result = await work(tx);
          if (!result.isOk) {
            restore(state, snapshot);
          }
          return result;
        } catch (error) {
          restore(state, snapshot);
          throw error;
        }
      });
      queue = run.catch(() => undefined);
      return run;
    },
  };

  const markSeen = (lease: Lease, at: Date) => {
    const seen = state.leaseSeen.find((held) => held.leaseId === lease.id);
    if (seen) {
      seen.at = at;
    } else {
      state.leaseSeen.push({ fleetId: lease.fleetId, leaseId: lease.id, at });
    }
  };

  const callers: CallerLookup = {
    byCrewTokenHash: (crewTokenHash, { at }) => {
      const lease = state.leases.find((held) => held.crewTokenHash === crewTokenHash);
      const owner = lease && ship(lease.fleetId, lease.shipId);
      if (!lease || owner?.retiredAt !== null) {
        return Promise.resolve(undefined);
      }
      if (lease.endedAt === null) {
        markSeen(lease, at);
      }
      return Promise.resolve(
        lease.endedAt === null
          ? { isOpen: true, crew: { ...authenticated(owner), leaseId: lease.id } }
          : { isOpen: false },
      );
    },
    useConsoleSession: ({ tokenHash, now: at, expiresAt }) => {
      const session = state.consoleSessions.find(
        (held) => held.tokenHash === tokenHash && held.endedAt === null && held.expiresAt > at,
      );
      const owner = session && ship(session.fleetId, session.shipId);
      if (!session || !owner) {
        return Promise.resolve(undefined);
      }
      session.lastUsedAt = at;
      session.expiresAt = expiresAt;
      const lease = state.leases.find((held) => held.id === session.leaseId);
      if (lease) {
        markSeen(lease, at);
      }
      return Promise.resolve({ ...authenticated(owner), consoleSessionId: session.id, leaseId: session.leaseId });
    },
    consoleSessionEnding: (tokenHash) =>
      Promise.resolve(state.consoleSessions.find((held) => held.tokenHash === tokenHash)?.endReason ?? undefined),
  };

  const accounts: OperatorAccountLookup = {
    byEmail: (email) => {
      const account = state.operatorAccounts.find((held) => held.email === email);
      return Promise.resolve(account && { ...account });
    },
  };

  const lastPingOf = (held: Ship): ShipFacts['lastPing'] => {
    const pings = state.messages.filter(
      (message) =>
        message.fleetId === held.fleetId &&
        message.contentType === PING_CONTENT_TYPE &&
        message.selector.kind === 'ship' &&
        message.selector.shipId === held.id,
    );
    const newest = pings.at(-1);
    const delivery = newest && state.deliveries.find((stored) => stored.messageId === newest.id);
    if (!newest || !delivery) {
      return null;
    }
    const pong = state.events.find(
      (event) => event.type === 'DeliveryAcknowledged' && event.deliveryId === delivery.id && event.details.answer === 'pong',
    );
    return { sentAt: newest.createdAt, deliveryState: delivery.state, answeredWithPongAt: pong?.occurredAt ?? null };
  };

  const lastModelOf = (held: Ship): ShipFacts['lastModel'] => {
    const stated = state.messages.filter(
      (message) => message.fleetId === held.fleetId && message.senderShipId === held.id && message.model !== null && message.resendOfMessageId === null,
    );
    const newest = stated.at(-1);
    return newest?.model ? { id: newest.model, statedAt: newest.createdAt } : null;
  };

  const factsOf = (held: Ship): ShipFacts => {
    const secret = state.credentials.find((credential) => credential.shipId === held.id && credential.invalidatedAt === null);
    const lease = state.leases.find((open) => open.shipId === held.id && open.endedAt === null);
    return {
      ship: { ...held },
      openLease: lease
        ? {
            location: { ...lease.location },
            harness: lease.harness,
            startedAt: lease.startedAt,
            lastSeenAt: state.leaseSeen.find((seen) => seen.leaseId === lease.id)?.at ?? lease.startedAt,
            report: state.leaseReports.find((held) => held.leaseId === lease.id)?.report ?? null,
          }
        : null,
      validSecret: secret ? { issuedAt: secret.issuedAt, claimedAt: secret.claimedAt } : null,
      lastPing: lastPingOf(held),
      lastModel: lastModelOf(held),
    };
  };
  const listing: FleetListing = {
    ships: (fleetId) =>
      Promise.resolve(
        state.ships
          .filter((held) => held.fleetId === fleetId)
          .sort((first, second) => first.id.localeCompare(second.id))
          .map(factsOf),
      ),
    ship: (fleetId, shipId) => {
      const held = state.ships.find((candidate) => candidate.fleetId === fleetId && candidate.id === shipId);
      return Promise.resolve(held && factsOf(held));
    },
    deliveryCounts: (fleetId, shipId) => {
      const ofFleet = state.deliveries.filter((delivery) => delivery.fleetId === fleetId);
      return Promise.resolve({
        inFlight: ofFleet.filter((delivery) => delivery.state === 'delivered' && delivery.claimedByShipId === shipId).length,
        open: ofFleet.filter(
          (delivery) =>
            (delivery.state === 'pending' || delivery.state === 'delivered') &&
            delivery.recipient.kind === 'ship' &&
            delivery.recipient.shipId === shipId,
        ).length,
      });
    },
  };


  let watches = 0;
  const wakeups: InMemoryWakeups = {
    watched: [],
    waits: [],
    nextWaits: [],
    watching: () => watches,
    watch: (address) => {
      wakeups.watched.push({ ...address });
      watches += 1;
      let isStopped = false;
      return {
        next: (waitMs) => {
          wakeups.waits.push(waitMs);
          const step = wakeups.nextWaits.shift();
          if (step) {
            return step();
          }
          clock.advance(waitMs);
          return Promise.resolve('timedOut');
        },
        stop: () => {
          if (!isStopped) {
            isStopped = true;
            watches -= 1;
          }
        },
      };
    },
  };

  const numbered = (fleetId: FleetId) =>
    state.events.filter((event) => event.fleetId === fleetId).map((event, index) => ({ ...event, seq: index + 1 }));
  const feed: FleetEventFeed = {
    lastSeq: (fleetId) => Promise.resolve(numbered(fleetId).length),
    after: (fleetId, { seq, limit }) => Promise.resolve(numbered(fleetId).slice(seq, seq + limit)),
  };

  const partyOf = (fleetId: FleetId, shipId: ShipId): HistoryParty => {
    const found = ship(fleetId, shipId);
    if (!found) {
      throw new Error(`no ship ${shipId}`);
    }
    return { id: found.id, name: found.name };
  };
  const recipientOf = (fleetId: FleetId, recipient: Recipient): HistoryRecipient =>
    recipient.kind === 'ship' ? { kind: 'ship', ship: partyOf(fleetId, recipient.shipId) } : recipient;
  const messageOf = (fleetId: FleetId, messageId: FleetEvent['messageId']): Message | undefined =>
    state.messages.find((held) => held.fleetId === fleetId && held.id === messageId);
  const deliveryOfMessage = (message: Message): Delivery => {
    const found = state.deliveries.find((held) => held.messageId === message.id);
    if (!found) {
      throw new Error(`no delivery of ${message.id}`);
    }
    return found;
  };
  const timelineEntryOf = (event: SequencedEvent): TimelineEntry => {
    const message = event.messageId === undefined ? undefined : messageOf(event.fleetId, event.messageId);
    return {
      seq: event.seq,
      id: event.id,
      type: event.type,
      occurredAt: event.occurredAt,
      actor: event.actor.kind === 'ship' ? partyOf(event.fleetId, event.actor.shipId) : null,
      ship: event.shipId === undefined ? null : partyOf(event.fleetId, event.shipId),
      message: message
        ? {
            id: message.id,
            sender: partyOf(message.fleetId, message.senderShipId),
            recipient: recipientOf(message.fleetId, message.selector),
            contentType: message.contentType,
            model: message.model,
          }
        : null,
      details: event.details,
    };
  };
  const historyMessageOf = (message: Message): HistoryMessage => {
    const delivery = deliveryOfMessage(message);
    return {
      id: message.id,
      sender: partyOf(message.fleetId, message.senderShipId),
      recipient: recipientOf(message.fleetId, message.selector),
      inReplyTo: message.inReplyToMessageId,
      sentAt: message.createdAt,
      contentType: message.contentType,
      model: message.model,
      payload: message.payload,
      delivery: {
        id: delivery.id,
        state: delivery.state,
        attempts: delivery.attempts,
        claimedBy: delivery.claimedByShipId === null ? null : partyOf(message.fleetId, delivery.claimedByShipId),
      },
    };
  };
  const changeOf = (event: SequencedEvent): DeliveryChange[] => {
    const { type } = event;
    if (!isDeliveryChangeType(type)) {
      return [];
    }
    const lease =
      event.type === 'DeliveryClaimed' ? state.leases.find((held) => held.id === event.details.leaseId) : undefined;
    const { attempts } = event.details;
    return [
      {
        seq: event.seq,
        type,
        occurredAt: event.occurredAt,
        ship: type === 'MessageAccepted' || event.shipId === undefined ? null : partyOf(event.fleetId, event.shipId),
        location: lease ? { ...lease.location } : null,
        harness: lease?.harness ?? null,
        attempts: typeof attempts === 'number' ? attempts : null,
      },
    ];
  };
  const newestFirst = (first: Message, second: Message) =>
    second.createdAt.getTime() - first.createdAt.getTime() || second.id.localeCompare(first.id);
  const history: ShipHistory = {
    timeline: (fleetId, { shipId, limit }) =>
      Promise.resolve(
        ship(fleetId, shipId) &&
          numbered(fleetId)
            .filter((event) => event.shipId === shipId || (event.actor.kind === 'ship' && event.actor.shipId === shipId))
            .reverse()
            .slice(0, limit)
            .map(timelineEntryOf),
      ),
    messages: (fleetId, { shipId, limit }) => {
      if (!ship(fleetId, shipId)) {
        return Promise.resolve(undefined);
      }
      const claimed = new Set(
        state.events
          .filter((event) => event.fleetId === fleetId && event.type === 'DeliveryClaimed' && event.shipId === shipId)
          .map((event) => event.messageId),
      );
      return Promise.resolve(
        state.messages
          .filter(
            (message) =>
              message.fleetId === fleetId &&
              (message.senderShipId === shipId ||
                (message.selector.kind === 'ship' && message.selector.shipId === shipId) ||
                claimed.has(message.id)),
          )
          .sort(newestFirst)
          .slice(0, limit)
          .map(historyMessageOf),
      );
    },
    message: (fleetId, messageId) => {
      const message = messageOf(fleetId, messageId);
      if (!message) {
        return Promise.resolve(undefined);
      }
      const delivery = deliveryOfMessage(message);
      const changes = numbered(fleetId)
        .filter((event) => event.deliveryId === delivery.id)
        .reverse()
        .flatMap(changeOf);
      return Promise.resolve({ ...historyMessageOf(message), history: changes });
    },
    inbox: (fleetId, { shipId, filter }) =>
      Promise.resolve(
        state.deliveries
          .filter(
            (delivery) =>
              delivery.fleetId === fleetId &&
              delivery.recipient.kind === 'ship' &&
              delivery.recipient.shipId === shipId &&
              isKeptBy(filter, delivery.state),
          )
          .flatMap((delivery) => {
            const message = messageOf(fleetId, delivery.messageId);
            return message ? [{ delivery, message }] : [];
          })
          .sort((first, second) => newestFirst(first.message, second.message))
          .map(({ delivery, message }) => {
            const acknowledged = numbered(fleetId).findLast(
              (event) => event.deliveryId === delivery.id && event.type === 'DeliveryAcknowledged',
            );
            const reply = acknowledged?.details.reply;
            const { id, sender, inReplyTo, sentAt, contentType, model, payload } = historyMessageOf(message);
            return {
              deliveryId: delivery.id,
              state: delivery.state,
              readAt: state.deliveryReads.find((read) => read.deliveryId === delivery.id)?.readAt ?? null,
              doneAt: acknowledged?.occurredAt ?? null,
              repliedWith: typeof reply === 'string' ? idSchema('message').parse(reply) : null,
              message: { id, sender, inReplyTo, sentAt, contentType, model, payload },
            };
          }),
      ),
    undeliverable: (fleetId) => {
      const events = numbered(fleetId);
      return Promise.resolve(
        state.deliveries
          .filter((delivery) => delivery.fleetId === fleetId && delivery.state === 'undeliverable')
          .map((delivery) => {
            const message = messageOf(fleetId, delivery.messageId);
            const since = events.findLast(
              (event) => event.deliveryId === delivery.id && event.type === 'DeliveryUndeliverable',
            );
            if (!message || !since) {
              throw new Error(`undeliverable ${delivery.id} without its message or its event`);
            }
            const { id, sender, recipient, inReplyTo, sentAt, contentType, model, payload } = historyMessageOf(message);
            return {
              seq: since.seq,
              entry: {
                deliveryId: delivery.id,
                attempts: delivery.attempts,
                since: since.occurredAt,
                message: { id, sender, recipient, inReplyTo, sentAt, contentType, model, payload },
              },
            };
          })
          .sort((first, second) => first.seq - second.seq)
          .map(({ entry }) => entry),
      );
    },
  };

  return { state, uow, ships: tx.ships, callers, accounts, listing, feed, history, clock, ids, hasher, passwords, random, wakeups };
}

/** The tables whose rows belong to a fleet by their fleet id: all but the fleets and the installation's requests. */
const FLEET_TABLES = [
  'ships',
  'leases',
  'credentials',
  'operatorAccounts',
  'consoleSessions',
  'messages',
  'deliveries',
  'deliveryReads',
  'leaseSeen',
  'leaseReports',
  'events',
  'notices',
] as const satisfies readonly Exclude<keyof InMemoryState, 'fleets' | 'installationRequests'>[];

const TABLES = [
  'fleets',
  'ships',
  'leases',
  'credentials',
  'operatorAccounts',
  'consoleSessions',
  'messages',
  'deliveries',
  'deliveryReads',
  'leaseSeen',
  'leaseReports',
  'events',
  'installationRequests',
  'notices',
] as const satisfies readonly (keyof InMemoryState)[];

/** Puts every table back as it was, keeping the arrays tests already hold. */
function restore(state: InMemoryState, snapshot: InMemoryState): void {
  for (const key of TABLES) {
    const rows: unknown[] = state[key];
    rows.splice(0, rows.length, ...snapshot[key]);
  }
}
