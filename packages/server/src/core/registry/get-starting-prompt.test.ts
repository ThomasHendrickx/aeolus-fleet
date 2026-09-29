import type { FleetId, ShipId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  FLEET_URL,
  initialiseFleet,
  operatorCaller,
  registryUseCases,
  secretIn,
} from '../../../test/support/core-fixtures.js';
import { createInMemoryCore, type InMemoryCore } from '../../../test/support/in-memory.js';
import { unwrap } from '../../../test/support/result.js';
import type { Caller } from '../shared/caller.js';
import { createGetStartingPrompt } from './get-starting-prompt.js';

let core: InMemoryCore;
let useCases: ReturnType<typeof registryUseCases>;
let fleetId: FleetId;
let argoId: ShipId;
let argo: Caller;
let scoutId: ShipId;
let firstSecret: string;

beforeEach(async () => {
  core = createInMemoryCore('2026-09-29T12:00:00.000Z');
  const fleet = await initialiseFleet(core);
  ({ fleetId, operatorShipId: argoId } = fleet);
  argo = operatorCaller(fleet);
  useCases = registryUseCases(core);
  const commissioned = unwrap(await useCases.commissionShip(argo, { name: 'scout', type: 'reviewer' }));
  scoutId = commissioned.shipId;
  firstSecret = secretIn(commissioned.prompt);
  core.clock.advance(60_000);
  core.state.events.length = 0;
});

function credentialsOf(shipId: ShipId) {
  return core.state.credentials.filter((credential) => credential.shipId === shipId);
}

function validSecretsOf(shipId: ShipId) {
  return credentialsOf(shipId).filter((credential) => credential.invalidatedAt === null);
}

/** A session crewing the ship: claiming arrives with slice 3. */
function crew(shipId: ShipId): void {
  core.state.leases.push({
    id: core.ids('lease'),
    fleetId,
    shipId,
    location: { kind: 'DEVICE', description: null },
    startedAt: core.clock.now(),
    endedAt: null,
  });
}

describe('getting a starting prompt', () => {
  it('issues a new prompt with the fleet URL, the ship id and a new secret while the ship awaits crew', async () => {
    const { shipId, prompt } = unwrap(await useCases.getStartingPrompt(argo, { shipId: scoutId }));

    expect(shipId).toBe(scoutId);
    expect(prompt).toContain(`Fleet URL: ${FLEET_URL}`);
    expect(prompt).toContain(`Ship id: ${scoutId}`);
    expect(secretIn(prompt)).toMatch(/^aeolus_sk_v1_./);
    expect(secretIn(prompt)).not.toBe(firstSecret);
  });

  it('invalidates the previous secret: the new one is the only valid secret', async () => {
    const { prompt } = unwrap(await useCases.getStartingPrompt(argo, { shipId: scoutId }));

    expect(credentialsOf(scoutId).map((credential) => [credential.secretHash, credential.invalidatedAt])).toEqual([
      [core.hasher.hash(firstSecret), core.clock.now()],
      [core.hasher.hash(secretIn(prompt)), null],
    ]);
  });

  it('keeps at most one valid secret per ship, however often a prompt is issued', async () => {
    for (let issue = 0; issue < 3; issue += 1) {
      unwrap(await useCases.getStartingPrompt(argo, { shipId: scoutId }));
    }

    expect(credentialsOf(scoutId)).toHaveLength(4);
    expect(validSecretsOf(scoutId)).toHaveLength(1);
  });

  it('stores the new secret only as its hash', async () => {
    const { prompt } = unwrap(await useCases.getStartingPrompt(argo, { shipId: scoutId }));

    expect(JSON.stringify(core.state)).not.toContain(`"${secretIn(prompt)}"`);
  });

  it('writes CredentialRevoked for the previous secret, then StartingPromptIssued, caused by the caller', async () => {
    const [previous] = credentialsOf(scoutId);

    unwrap(await useCases.getStartingPrompt(argo, { shipId: scoutId }));

    const [, issued] = credentialsOf(scoutId);
    expect(core.state.events).toEqual([
      expect.objectContaining({
        fleetId,
        type: 'CredentialRevoked',
        occurredAt: core.clock.now(),
        actor: { kind: 'ship', shipId: argoId },
        shipId: scoutId,
        details: { credentialId: previous?.id },
      }),
      expect.objectContaining({
        fleetId,
        type: 'StartingPromptIssued',
        occurredAt: core.clock.now(),
        actor: { kind: 'ship', shipId: argoId },
        shipId: scoutId,
        details: { credentialId: issued?.id },
      }),
    ]);
  });

  it('revokes nothing when the ship holds no valid secret', async () => {
    for (const credential of credentialsOf(scoutId)) {
      credential.invalidatedAt = core.clock.now();
    }

    unwrap(await useCases.getStartingPrompt(argo, { shipId: scoutId }));

    expect(core.state.events.map((event) => event.type)).toEqual(['StartingPromptIssued']);
    expect(validSecretsOf(scoutId)).toHaveLength(1);
  });
});

describe('a starting prompt is issued only while the ship awaits crew', () => {
  it('is refused while a session crews the ship, and nothing changes', async () => {
    crew(scoutId);
    const before = structuredClone(core.state);

    await expect(useCases.getStartingPrompt(argo, { shipId: scoutId })).resolves.toEqual({
      isOk: false,
      error: {
        kind: 'SHIP_NOT_AWAITING_CREW',
        message: 'scout is crewed: a starting prompt is issued only while a ship awaits crew',
      },
    });
    expect(core.state).toEqual(before);
  });

  it('is refused for a retired ship', async () => {
    const scout = core.state.ships.find((ship) => ship.id === scoutId);
    if (scout) {
      scout.retiredAt = core.clock.now();
    }

    await expect(useCases.getStartingPrompt(argo, { shipId: scoutId })).resolves.toEqual({
      isOk: false,
      error: {
        kind: 'SHIP_NOT_AWAITING_CREW',
        message: 'scout is retired: a starting prompt is issued only while a ship awaits crew',
      },
    });
    expect(validSecretsOf(scoutId).map((credential) => credential.secretHash)).toEqual([core.hasher.hash(firstSecret)]);
  });

  it('is refused for argo, even with no console session, and argo keeps its secret', async () => {
    const before = structuredClone(core.state);

    await expect(useCases.getStartingPrompt(argo, { shipId: argoId })).resolves.toEqual({
      isOk: false,
      error: {
        kind: 'OPERATOR_SHIP_GETS_NO_STARTING_PROMPT',
        message: 'argo is crewed through the console and gets no starting prompt; a server command replaces its secret',
      },
    });
    expect(core.state).toEqual(before);
  });
});

describe('the ship a starting prompt is for', () => {
  it('is refused when it does not exist', async () => {
    const unknown = core.ids('ship');

    await expect(useCases.getStartingPrompt(argo, { shipId: unknown })).resolves.toEqual({
      isOk: false,
      error: { kind: 'SHIP_NOT_FOUND', message: `Ship ${unknown} does not exist` },
    });
  });

  it("is refused when it belongs to another fleet: the caller's fleet scopes the call", async () => {
    const elsewhere = { ...argo, fleetId: core.ids('fleet') };

    await expect(useCases.getStartingPrompt(elsewhere, { shipId: scoutId })).resolves.toMatchObject({
      isOk: false,
      error: { kind: 'SHIP_NOT_FOUND' },
    });
    expect(validSecretsOf(scoutId)).toHaveLength(1);
  });
});

describe('a failed starting prompt', () => {
  it('leaves the previous secret valid when a write in the transaction fails', async () => {
    const before = structuredClone(core.state);
    const getStartingPrompt = createGetStartingPrompt({
      uow: {
        run: (work) =>
          core.uow.run((tx) =>
            work({ ...tx, events: { append: () => Promise.reject(new Error('event log unavailable')) } }),
          ),
      },
      clock: core.clock,
      ids: core.ids,
      secrets: { hasher: core.hasher, random: core.random },
      fleetUrl: FLEET_URL,
    });

    await expect(getStartingPrompt(argo, { shipId: scoutId })).rejects.toThrow('event log unavailable');
    expect(core.state).toEqual(before);
  });
});
