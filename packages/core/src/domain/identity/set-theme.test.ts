import { beforeEach, describe, expect, it } from 'vitest';

import { identityUseCases, initialiseFleet, OPERATOR } from '../../../test/support/core-fixtures.js';
import { createInMemoryCore, type InMemoryCore } from '../../../test/support/in-memory.js';
import { unwrap } from '../../../test/support/result.js';
import type { Caller } from '../shared/caller.js';

let core: InMemoryCore;
let useCases: ReturnType<typeof identityUseCases>;
let console: Caller;

beforeEach(async () => {
  core = createInMemoryCore('2026-10-01T08:02:00.000Z');
  useCases = identityUseCases(core);
  await initialiseFleet(core);
  ({ caller: console } = unwrap(await useCases.signIn({ ...OPERATOR, device: 'Mac · Chrome' })));
  core.clock.advance(60_000);
});

describe('choosing a theme', () => {
  it.each(['light', 'dark', 'system'] as const)('stores %s on the account, so it follows the operator', async (theme) => {
    unwrap(await useCases.setTheme(console, { theme }));

    await expect(useCases.readAccount(console)).resolves.toMatchObject({ value: { theme } });
    expect(core.state.operatorAccounts[0]?.theme).toBe(theme);
  });

  it('keeps the theme across a new sign-in', async () => {
    unwrap(await useCases.setTheme(console, { theme: 'dark' }));
    core.clock.advance(60_000);
    const { caller: next } = unwrap(await useCases.signIn(OPERATOR));

    await expect(useCases.readAccount(next)).resolves.toMatchObject({ value: { theme: 'dark' } });
  });

  it('writes no event: a theme is how the console looks, not a fleet change', async () => {
    core.state.events.length = 0;

    unwrap(await useCases.setTheme(console, { theme: 'dark' }));
    expect(core.state.events).toEqual([]);
  });

  it('refuses a caller that is no console session', async () => {
    const withoutSession: Caller = { shipId: console.shipId, fleetId: console.fleetId, kind: console.kind, scopes: console.scopes };

    await expect(useCases.setTheme(withoutSession, { theme: 'dark' })).resolves.toMatchObject({
      isOk: false,
      error: { kind: 'NOT_THE_OPERATOR_SHIP' },
    });
  });
});
