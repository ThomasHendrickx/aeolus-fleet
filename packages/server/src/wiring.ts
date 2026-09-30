import { createIdGenerator, type IdGenerator } from '@aeolus-fleet/common';

import { argon2idPasswordHasher } from './adapters/crypto/passwords.js';
import { cryptoRandomTokens, sha256Hasher } from './adapters/crypto/secrets.js';
import type { PrismaClient } from './adapters/prisma/client.js';
import { createPrismaFleetCounter } from './adapters/prisma/fleet-counter.js';
import {
  createPrismaFleetListing,
  createPrismaFleetRepository,
  createPrismaShipRepository,
} from './adapters/prisma/registry.js';
import { createPrismaOperatorAccountLookup } from './adapters/prisma/identity.js';
import { createPrismaCallers, createPrismaUnitOfWork } from './adapters/prisma/unit-of-work.js';
import { createAuthenticate, type Authenticate } from './core/identity/authenticate.js';
import { createResetOperatorPassword, type ResetOperatorPassword } from './core/identity/reset-operator-password.js';
import { createSignIn, type SignIn } from './core/identity/sign-in.js';
import { createSignOut, type SignOut } from './core/identity/sign-out.js';
import { createClaimShip, type ClaimShip } from './core/registry/claim-ship.js';
import { createCommissionShip, type CommissionShip } from './core/registry/commission-ship.js';
import { createGetStartingPrompt, type GetStartingPrompt } from './core/registry/get-starting-prompt.js';
import { createInitialiseFleet, type InitialiseFleet } from './core/registry/initialise-fleet.js';
import { createListFleet, type ListFleet } from './core/registry/list-fleet.js';
import { createListFleets, type ListFleets } from './core/registry/list-fleets.js';
import { createWhoami, type Whoami } from './core/registry/whoami.js';
import type { Clock } from './core/shared/clock.js';
import { createPing, type Ping } from './core/shared/ping.js';

export interface UseCases {
  ping: Ping;
  initialiseFleet: InitialiseFleet;
  listFleets: ListFleets;
  commissionShip: CommissionShip;
  getStartingPrompt: GetStartingPrompt;
  listFleet: ListFleet;
  claimShip: ClaimShip;
  whoami: Whoami;
  signIn: SignIn;
  signOut: SignOut;
  resetOperatorPassword: ResetOperatorPassword;
  authenticate: Authenticate;
}

export const systemClock: Clock = { now: () => new Date() };

/**
 * Wires every use case to Postgres through Prisma. The HTTP app and the server
 * commands share it. `fleetUrl` is where ships reach the fleet: the URL every
 * starting prompt carries.
 */
export function createUseCases(options: {
  prisma: PrismaClient;
  fleetUrl: string;
  clock?: Clock;
  ids?: IdGenerator;
}): UseCases {
  const { prisma } = options;
  const clock = options.clock ?? systemClock;
  const ids = options.ids ?? createIdGenerator();
  const uow = createPrismaUnitOfWork(prisma);
  const secrets = { hasher: sha256Hasher, random: cryptoRandomTokens };

  return {
    ping: createPing({ clock, fleets: createPrismaFleetCounter(prisma) }),
    initialiseFleet: createInitialiseFleet({ uow, clock, ids, passwords: argon2idPasswordHasher }),
    listFleets: createListFleets({ fleets: createPrismaFleetRepository(prisma) }),
    commissionShip: createCommissionShip({ uow, clock, ids, secrets, fleetUrl: options.fleetUrl }),
    getStartingPrompt: createGetStartingPrompt({ uow, clock, ids, secrets, fleetUrl: options.fleetUrl }),
    listFleet: createListFleet({ listing: createPrismaFleetListing(prisma) }),
    claimShip: createClaimShip({ uow, clock, ids, secrets }),
    whoami: createWhoami({ ships: createPrismaShipRepository(prisma) }),
    signIn: createSignIn({
      uow,
      accounts: createPrismaOperatorAccountLookup(prisma),
      clock,
      ids,
      ...secrets,
      passwords: argon2idPasswordHasher,
    }),
    signOut: createSignOut({ uow, clock, ids }),
    resetOperatorPassword: createResetOperatorPassword({ uow, clock, ids, passwords: argon2idPasswordHasher }),
    authenticate: createAuthenticate({ callers: createPrismaCallers(prisma), hasher: sha256Hasher, clock }),
  };
}
