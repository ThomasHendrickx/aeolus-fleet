import { createIdGenerator, type FleetId, type ShipId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { identityUseCases, initialiseFleet } from '../../../test/support/core-fixtures.js';
import { createInMemoryCore, type InMemoryCore } from '../../../test/support/in-memory.js';

let core: InMemoryCore;
let useCases: ReturnType<typeof identityUseCases>;
let fleetId: FleetId;
let argoId: ShipId;
let oldSecret: string;

beforeEach(async () => {
  core = createInMemoryCore();
  useCases = identityUseCases(core);
  ({ fleetId, operatorShipId: argoId, secret: oldSecret } = await initialiseFleet(core));
});

describe("replacing argo's secret", () => {
  it('makes the old secret fail and the new one work', async () => {
    const { secret, shipId } = await useCases.replaceOperatorSecret({ fleetId });

    expect(shipId).toBe(argoId);
    expect(secret).toMatch(/^aeolus_sk_v1_./);
    expect(secret).not.toBe(oldSecret);
    await expect(useCases.signIn({ secret: oldSecret })).rejects.toMatchObject({ code: 'INVALID_SECRET' });
    await expect(useCases.authenticate.bySecret(oldSecret)).resolves.toBeUndefined();
    await expect(useCases.signIn({ secret })).resolves.toMatchObject({ caller: { shipId: argoId } });
    await expect(useCases.authenticate.bySecret(secret)).resolves.toMatchObject({ shipId: argoId });
  });

  it('keeps exactly one valid secret, stored as a hash', async () => {
    const { secret } = await useCases.replaceOperatorSecret({ fleetId });

    const valid = core.state.credentials.filter((credential) => credential.invalidatedAt === null);
    expect(valid).toEqual([expect.objectContaining({ shipId: argoId, secretHash: core.hasher.hash(secret) })]);
    expect(core.state.credentials).toHaveLength(2);
  });

  it("ends every console session and argo's lease", async () => {
    const { token } = await useCases.signIn({ secret: oldSecret });
    core.state.events.length = 0;

    await useCases.replaceOperatorSecret({ fleetId });

    await expect(useCases.authenticate.byConsoleSession(token)).resolves.toBeUndefined();
    expect(core.state.consoleSessions.every((session) => session.endedAt !== null)).toBe(true);
    expect(core.state.leases.every((lease) => lease.endedAt !== null)).toBe(true);
    expect(core.state.events.map((event) => [event.type, event.actor, event.shipId])).toEqual([
      ['CredentialRevoked', { kind: 'system' }, argoId],
      ['LeaseRevoked', { kind: 'system' }, argoId],
    ]);
    expect(core.state.events[1]?.details).toMatchObject({ reason: 'secretReplaced' });
  });

  it('also ends a session that expired without signing out', async () => {
    const { consoleSessionId } = await useCases.signIn({ secret: oldSecret });
    core.clock.advance(31 * 24 * 60 * 60 * 1000);

    await useCases.replaceOperatorSecret({ fleetId });

    expect(core.state.consoleSessions.find((session) => session.id === consoleSessionId)?.endedAt).toEqual(
      core.clock.now(),
    );
    expect(core.state.leases.every((lease) => lease.endedAt !== null)).toBe(true);
  });

  it('writes only CredentialRevoked when nobody is signed in', async () => {
    core.state.events.length = 0;

    await useCases.replaceOperatorSecret({ fleetId });

    expect(core.state.events).toEqual([
      expect.objectContaining({
        type: 'CredentialRevoked',
        actor: { kind: 'system' },
        shipId: argoId,
        details: { credentialId: core.state.credentials[0]?.id },
      }),
    ]);
  });

  it('refuses a fleet that does not exist', async () => {
    const unknown = createIdGenerator()('fleet');

    await expect(useCases.replaceOperatorSecret({ fleetId: unknown })).rejects.toMatchObject({
      code: 'FLEET_NOT_FOUND',
    });
  });
});
