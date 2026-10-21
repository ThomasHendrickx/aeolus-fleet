import { idSchema } from '@aeolus-fleet/common';

import { argon2idPasswordHasher } from '../../src/adapters/crypto/passwords.js';
import type { PrismaClient } from '../../src/adapters/prisma/client.js';
import { createPrismaOperatorAccountRepository } from '../../src/adapters/prisma/identity.js';
import type { FleetInitialised } from '../../src/domain/registry/initialise-fleet.js';
import type { Result } from '../../src/domain/shared/result.js';
import { OPERATOR } from '../../src/testing/fleet.js';

/** Gives argo's own sign-in of this fleet the email and password the tests sign in with, as Settings would set them. */
export async function giveOperatorLogin(prisma: PrismaClient, operator: { fleetId: string; operatorId: string }): Promise<void> {
  const passwordHash = await argon2idPasswordHasher.hash(OPERATOR.password);
  await createPrismaOperatorAccountRepository(prisma).changeLogin({
    fleetId: idSchema('fleet').parse(operator.fleetId),
    operatorId: idSchema('operator').parse(operator.operatorId),
    email: OPERATOR.email,
    passwordHash,
  });
}

/**
 * Gives argo's own sign-in of the fleet just initialised the email and
 * password the tests sign in with, as Settings would set them: fleet:init
 * gives it none (accounts design, A1). Answers the initialising as it came.
 */
export async function withOperatorLogin<E>(prisma: PrismaClient, initialising: Promise<Result<FleetInitialised, E>>): Promise<Result<FleetInitialised, E>> {
  const initialised = await initialising;
  if (initialised.isOk) {
    await giveOperatorLogin(prisma, initialised.value);
  }
  return initialised;
}
