import { beforeEach, describe, expect, it } from 'vitest';

import { identityUseCases, initialiseFleet, OPERATOR } from '../../../test/support/core-fixtures.js';
import { createInMemoryCore, type InMemoryCore } from '../../../test/support/in-memory.js';
import { unwrap } from '../../../test/support/result.js';
import type { Caller } from '../shared/caller.js';

let core: InMemoryCore;
let useCases: ReturnType<typeof identityUseCases>;
let console: Caller;
let signedInAt: Date;

beforeEach(async () => {
  core = createInMemoryCore('2026-10-01T08:02:00.000Z');
  useCases = identityUseCases(core);
  await initialiseFleet(core);
  signedInAt = core.clock.now();
  ({ caller: console } = unwrap(await useCases.signIn({ ...OPERATOR, device: 'Mac · Chrome' })));
  core.clock.advance(60_000);
});

describe("reading the operator's account", () => {
  it('gives the email, the theme (System until chosen) and this session: its device and since when', async () => {
    await expect(useCases.readAccount(console)).resolves.toEqual({
      isOk: true,
      value: { email: OPERATOR.email, theme: 'system', session: { device: 'Mac · Chrome', since: signedInAt } },
    });
  });

  it('refuses a caller that is no console session', async () => {
    const withoutSession: Caller = { shipId: console.shipId, fleetId: console.fleetId, kind: console.kind, scopes: console.scopes };

    await expect(useCases.readAccount(withoutSession)).resolves.toMatchObject({
      isOk: false,
      error: { kind: 'NOT_THE_OPERATOR_SHIP' },
    });
  });
});
