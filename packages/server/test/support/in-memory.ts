import { createIdGenerator, type FleetId, type IdGenerator, type ShipId } from '@aeolus-fleet/common';

import type { ConsoleSession } from '../../src/core/identity/console-session.js';
import type { Credential } from '../../src/core/identity/credential.js';
import type {
  AuthenticatedShip,
  CallerLookup,
  ConsoleSessionRepository,
  CredentialRepository,
} from '../../src/core/identity/ports.js';
import type { Fleet } from '../../src/core/registry/fleet.js';
import type { Lease } from '../../src/core/registry/lease.js';
import type {
  FleetRepository,
  InFlightDeliveries,
  LeaseRepository,
  ShipRepository,
} from '../../src/core/registry/ports.js';
import type { Ship } from '../../src/core/registry/ship.js';
import type { Clock } from '../../src/core/shared/clock.js';
import type { EventLog, FleetEvent } from '../../src/core/shared/events.js';
import type { RandomTokens, SecretHasher } from '../../src/core/shared/secrets.js';
import type { UnitOfWork } from '../../src/core/shared/unit-of-work.js';

/**
 * In-memory ports for unit tests of the core. Every repository reads and writes
 * one plain state object; the unit of work restores it when the work refuses or
 * throws, so tests can prove a use case leaves nothing behind.
 */

/** Just enough of a delivery to prove what the lease operations do with deliveries in flight. */
export interface InMemoryDelivery {
  id: string;
  fleetId: FleetId;
  state: 'pending' | 'delivered' | 'acknowledged';
  claimedByShipId: ShipId | null;
}

export interface InMemoryState {
  fleets: Fleet[];
  ships: Ship[];
  leases: Lease[];
  credentials: Credential[];
  consoleSessions: ConsoleSession[];
  deliveries: InMemoryDelivery[];
  events: FleetEvent[];
}

export interface InMemoryTx {
  fleets: FleetRepository;
  ships: ShipRepository;
  leases: LeaseRepository;
  inFlightDeliveries: InFlightDeliveries;
  credentials: CredentialRepository;
  consoleSessions: ConsoleSessionRepository;
  events: EventLog;
}

export interface InMemoryCore {
  state: InMemoryState;
  uow: UnitOfWork<InMemoryTx>;
  callers: CallerLookup;
  clock: Clock & { set(iso: string | Date): void; advance(ms: number): void };
  ids: IdGenerator;
  hasher: SecretHasher;
  random: RandomTokens;
}

export function createInMemoryCore(startAt = '2026-09-29T12:00:00.000Z'): InMemoryCore {
  const state: InMemoryState = {
    fleets: [],
    ships: [],
    leases: [],
    credentials: [],
    consoleSessions: [],
    deliveries: [],
    events: [],
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
    },
    ships: {
      create: (created) => {
        state.ships.push({ ...created });
        return Promise.resolve();
      },
      findOperatorShip: (fleetId) =>
        Promise.resolve(state.ships.find((found) => found.fleetId === fleetId && found.kind === 'operator')),
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
      returnToPending: (fleetId, shipId) => {
        const inFlight = state.deliveries.filter(
          (delivery) =>
            delivery.fleetId === fleetId && delivery.state === 'delivered' && delivery.claimedByShipId === shipId,
        );
        for (const delivery of inFlight) {
          delivery.state = 'pending';
          delivery.claimedByShipId = null;
        }
        return Promise.resolve(inFlight.length);
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
        const owner = credential && ship(credential.fleetId, credential.shipId);
        if (!credential || owner?.retiredAt !== null) {
          return Promise.resolve(undefined);
        }
        return Promise.resolve({ credential: { ...credential }, ship: authenticated(owner) });
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
    consoleSessions: {
      create: (session) => {
        if (state.consoleSessions.some((held) => held.fleetId === session.fleetId && held.endedAt === null)) {
          return Promise.reject(new Error('unique violation: the fleet already has a live console session'));
        }
        state.consoleSessions.push({ ...session });
        return Promise.resolve();
      },
      end: ({ fleetId, consoleSessionId, at }) => {
        const session = state.consoleSessions.find((held) => held.fleetId === fleetId && held.id === consoleSessionId);
        if (session?.endedAt !== null) {
          return Promise.resolve(undefined);
        }
        session.endedAt = at;
        return Promise.resolve({ ...session });
      },
      endAll: (fleetId, at) => {
        const open = state.consoleSessions.filter((held) => held.fleetId === fleetId && held.endedAt === null);
        for (const session of open) {
          session.endedAt = at;
        }
        return Promise.resolve(open.map((session) => ({ ...session })));
      },
    },
    events: {
      append: (event) => {
        state.events.push({ ...event });
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

  const callers: CallerLookup = {
    bySecretHash: async (secretHash) => (await tx.credentials.findValidBySecretHashForUpdate(secretHash))?.ship,
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
      return Promise.resolve({ ...authenticated(owner), consoleSessionId: session.id });
    },
  };

  return { state, uow, callers, clock, ids, hasher, random };
}

const TABLES = [
  'fleets',
  'ships',
  'leases',
  'credentials',
  'consoleSessions',
  'deliveries',
  'events',
] as const satisfies readonly (keyof InMemoryState)[];

/** Puts every table back as it was, keeping the arrays tests already hold. */
function restore(state: InMemoryState, snapshot: InMemoryState): void {
  for (const key of TABLES) {
    const rows: unknown[] = state[key];
    rows.splice(0, rows.length, ...snapshot[key]);
  }
}
