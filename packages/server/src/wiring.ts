import { createIdGenerator, type IdGenerator } from '@aeolus-fleet/common';

import { cryptoRandomTokens, sha256Hasher } from './adapters/crypto/secrets.js';
import type { PrismaClient } from './adapters/prisma/client.js';
import { createPrismaFleetCounter } from './adapters/prisma/fleet-counter.js';
import { createPrismaFleetRepository } from './adapters/prisma/registry.js';
import { createPrismaCallers, createPrismaUnitOfWork } from './adapters/prisma/unit-of-work.js';
import { createAuthenticate, type Authenticate } from './core/identity/authenticate.js';
import { createReplaceOperatorSecret, type ReplaceOperatorSecret } from './core/identity/replace-operator-secret.js';
import { createSignIn, type SignIn } from './core/identity/sign-in.js';
import { createSignOut, type SignOut } from './core/identity/sign-out.js';
import { createInitialiseFleet, type InitialiseFleet } from './core/registry/initialise-fleet.js';
import { createListFleets, type ListFleets } from './core/registry/list-fleets.js';
import type { Clock } from './core/shared/clock.js';
import { createPing, type Ping } from './core/shared/ping.js';

export interface UseCases {
  ping: Ping;
  initialiseFleet: InitialiseFleet;
  listFleets: ListFleets;
  signIn: SignIn;
  signOut: SignOut;
  replaceOperatorSecret: ReplaceOperatorSecret;
  authenticate: Authenticate;
}

export const systemClock: Clock = { now: () => new Date() };

/** Wires every use case to Postgres through Prisma. The HTTP app and the server commands share it. */
export function createUseCases(options: { prisma: PrismaClient; clock?: Clock; ids?: IdGenerator }): UseCases {
  const { prisma } = options;
  const clock = options.clock ?? systemClock;
  const ids = options.ids ?? createIdGenerator();
  const uow = createPrismaUnitOfWork(prisma);
  const secrets = { hasher: sha256Hasher, random: cryptoRandomTokens };

  return {
    ping: createPing({ clock, fleets: createPrismaFleetCounter(prisma) }),
    initialiseFleet: createInitialiseFleet({ uow, clock, ids, secrets }),
    listFleets: createListFleets({ fleets: createPrismaFleetRepository(prisma) }),
    signIn: createSignIn({ uow, clock, ids, ...secrets }),
    signOut: createSignOut({ uow, clock, ids }),
    replaceOperatorSecret: createReplaceOperatorSecret({ uow, clock, ids, ...secrets }),
    authenticate: createAuthenticate({ callers: createPrismaCallers(prisma), hasher: sha256Hasher, clock }),
  };
}
