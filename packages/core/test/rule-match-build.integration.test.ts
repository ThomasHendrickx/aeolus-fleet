import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildRuleMatchesOf } from '../src/adapters/prisma/build-rule-matches.js';
import { createPostgresCore, type PostgresCore } from './support/postgres-core.js';
import { aMatchedFleet, expectRuleMatchesKept, storedRuleMatchesOf } from './support/rule-match-postgres.js';

// Proof step 5 of rule-matches.md with rollout A: the release step builds
// every fleet's matches before core serves; it is idempotent, a retry repairs
// a partial or stale build, and a failure fails the step.

let core: PostgresCore;
beforeAll(async () => {
  core = await createPostgresCore();
});
afterAll(async () => {
  await core.close();
});

describe('the release step building rule matches', () => {
  it('fills every populated fleet whose matches were never built, and a second run changes nothing', async () => {
    // Given two populated fleets as a release finds them: no rule matches stored.
    const first = await aMatchedFleet(core);
    const second = await aMatchedFleet(core);
    await core.prisma.$executeRaw`DELETE FROM ship_rule_matches`;

    // When the release step builds, then builds again.
    await buildRuleMatchesOf(core.databaseUrl);
    const built = [await storedRuleMatchesOf(core, first.fleetId), await storedRuleMatchesOf(core, second.fleetId)];
    await buildRuleMatchesOf(core.databaseUrl);

    // Then each fleet holds a fresh computation, nonempty, and the second run left it as it was.
    await expectRuleMatchesKept(core, first.fleetId);
    await expectRuleMatchesKept(core, second.fleetId);
    expect(built[0]?.length).toBeGreaterThan(0);
    expect([await storedRuleMatchesOf(core, first.fleetId), await storedRuleMatchesOf(core, second.fleetId)]).toEqual(built);
  });

  it('repairs a partial or stale build when retried', async () => {
    // Given a fleet whose build stopped halfway and left a stale row.
    const fleet = await aMatchedFleet(core);
    await core.prisma.$executeRaw`DELETE FROM ship_rule_matches WHERE fleet_id = ${fleet.fleetId} AND verb = 'read'`;
    await core.prisma.$executeRaw`
      INSERT INTO ship_rule_matches (fleet_id, ship_id, verb, source, to_rules, to_rules_every_actor)
      VALUES (${fleet.fleetId}, ${fleet.second}, 'read', 'installation', repeat('1', 20)::varbit, repeat('1', 20)::varbit)`;

    // When the release step runs again.
    await buildRuleMatchesOf(core.databaseUrl);

    // Then the fleet holds a fresh computation.
    await expectRuleMatchesKept(core, fleet.fleetId);
  });

  it('fails the step when a fleet cannot be built, so core does not start serving', async () => {
    // Given a fleet whose stored declaration cannot be read as rules.
    const fleet = await aMatchedFleet(core);
    await core.prisma.$executeRaw`UPDATE declared_network_rules SET rules = '[{"verb":"send","from":[],"to":["not-a-value-id"]}]'::jsonb WHERE fleet_id = ${fleet.fleetId}`;

    // When the release step runs.
    const built = buildRuleMatchesOf(core.databaseUrl);

    // Then it fails rather than finishing with that fleet unbuilt.
    await expect(built).rejects.toThrow();
  });
});
