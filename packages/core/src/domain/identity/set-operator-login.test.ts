import { beforeEach, describe, expect, it } from 'vitest';

import { hostedFleet, identityUseCases, initialiseFleet, OPERATOR } from '../../../test/support/core-fixtures.js';
import { createInMemoryCore, type InMemoryCore } from '../../../test/support/in-memory.js';
import { unwrap } from '../../testing/result.js';
import type { ShipCaller } from '../shared/caller.js';
import { createSetOperatorLogin } from './set-operator-login.js';

const NEW_LOGIN = { email: 'Mathilde@Example.com', password: 'staple battery horse correct', currentPassword: OPERATOR.password };

let core: InMemoryCore;
let useCases: ReturnType<typeof identityUseCases>;
let setOperatorLogin: ReturnType<typeof createSetOperatorLogin>;
let console: ShipCaller;

function setOperatorLoginWhere(options: { isSelfHosted: boolean }) {
  return createSetOperatorLogin({ uow: core.uow, clock: core.clock, ids: core.ids, passwords: core.passwords, ...options });
}

beforeEach(async () => {
  core = createInMemoryCore('2026-10-21T09:00:00.000Z');
  useCases = identityUseCases(core);
  setOperatorLogin = setOperatorLoginWhere({ isSelfHosted: true });
  await initialiseFleet(core);
  ({ caller: console } = unwrap(await useCases.signIn({ ...OPERATOR, device: 'Mac · Chrome' })));
});

describe("setting argo's email and password from the console", () => {
  it('signs in with the new email and password afterwards', async () => {
    unwrap(await setOperatorLogin(console, NEW_LOGIN));

    await expect(useCases.signIn({ email: 'mathilde@example.com', password: NEW_LOGIN.password })).resolves.toMatchObject({
      isOk: true,
      value: { caller: { shipId: console.shipId } },
    });
  });

  it('makes the old email and password fail', async () => {
    unwrap(await setOperatorLogin(console, NEW_LOGIN));

    await expect(useCases.signIn(OPERATOR)).resolves.toMatchObject({ isOk: false, error: { kind: 'WRONG_EMAIL_OR_PASSWORD' } });
  });

  it('stores the email trimmed and in lowercase, and only the hash of the password', async () => {
    unwrap(await setOperatorLogin(console, { ...NEW_LOGIN, email: ' Mathilde@Example.com ' }));

    expect(core.state.operatorAccounts[0]).toMatchObject({
      email: 'mathilde@example.com',
      passwordHash: await core.passwords.hash(NEW_LOGIN.password),
    });
    expect(JSON.stringify(core.state)).not.toContain(`"${NEW_LOGIN.password}"`);
  });

  it('keeps the console session that set it signed in', async () => {
    unwrap(await setOperatorLogin(console, NEW_LOGIN));

    await expect(useCases.readAccount(console)).resolves.toMatchObject({ isOk: true });
  });

  it('keeps the same email with a new password', async () => {
    unwrap(await setOperatorLogin(console, { ...NEW_LOGIN, email: OPERATOR.email }));

    await expect(useCases.signIn({ email: OPERATOR.email, password: NEW_LOGIN.password })).resolves.toMatchObject({ isOk: true });
  });

  it("writes OperatorLoginSet on argo's timeline, by argo, without the email or the password", async () => {
    core.state.events.length = 0;

    unwrap(await setOperatorLogin(console, NEW_LOGIN));

    expect(core.state.events).toEqual([
      expect.objectContaining({
        fleetId: console.fleetId,
        type: 'OperatorLoginSet',
        occurredAt: new Date('2026-10-21T09:00:00.000Z'),
        actor: { kind: 'ship', shipId: console.shipId },
        shipId: console.shipId,
        details: { operatorId: core.state.operatorAccounts[0]?.id },
      }),
    ]);
  });

  it.each([
    { label: 'no current password', input: { email: NEW_LOGIN.email, password: NEW_LOGIN.password } },
    { label: 'a wrong current password', input: { ...NEW_LOGIN, currentPassword: 'not the password at all' } },
  ])('refuses $label while argo has a password, and changes nothing', async ({ input }) => {
    const before = structuredClone(core.state);

    await expect(setOperatorLogin(console, input)).resolves.toMatchObject({
      isOk: false,
      error: { kind: 'WRONG_PASSWORD', message: 'That is not your current password' },
    });
    expect(core.state).toEqual(before);
  });

  it('asks no current password while argo has none, such as one that signed in by a link', async () => {
    const [account] = core.state.operatorAccounts;
    if (account) {
      account.passwordHash = null;
    }

    unwrap(await setOperatorLogin(console, { email: NEW_LOGIN.email, password: NEW_LOGIN.password }));

    await expect(useCases.signIn({ email: NEW_LOGIN.email, password: NEW_LOGIN.password })).resolves.toMatchObject({ isOk: true });
  });

  it.each([
    { label: 'an email that is not an address', input: { ...NEW_LOGIN, email: 'mathilde' }, kind: 'INVALID_EMAIL' },
    { label: 'a password of 11 characters', input: { ...NEW_LOGIN, password: 'a'.repeat(11) }, kind: 'INVALID_PASSWORD' },
  ])('refuses $label and changes nothing', async ({ input, kind }) => {
    const before = structuredClone(core.state);

    await expect(setOperatorLogin(console, input)).resolves.toMatchObject({ isOk: false, error: { kind } });
    expect(core.state).toEqual(before);
  });

  it('takes a password of exactly 12 characters', async () => {
    unwrap(await setOperatorLogin(console, { ...NEW_LOGIN, password: 'a'.repeat(12) }));

    await expect(useCases.signIn({ email: NEW_LOGIN.email, password: 'a'.repeat(12) })).resolves.toMatchObject({ isOk: true });
  });

  it("refuses an email another fleet's operator signs in with", async () => {
    await hostedFleet(core, 'lena@example.com');
    const before = structuredClone(core.state);

    await expect(setOperatorLogin(console, { ...NEW_LOGIN, email: 'Lena@example.com' })).resolves.toMatchObject({
      isOk: false,
      error: { kind: 'OPERATOR_EMAIL_TAKEN' },
    });
    expect(core.state).toEqual(before);
  });

  it('refuses where core trusts pagasae: a hosted fleet has no own sign-in for argo', async () => {
    const before = structuredClone(core.state);

    await expect(setOperatorLoginWhere({ isSelfHosted: false })(console, NEW_LOGIN)).resolves.toMatchObject({
      isOk: false,
      error: { kind: 'NO_OWN_SIGN_IN' },
    });
    expect(core.state).toEqual(before);
  });

  it('refuses a caller that is no console session of argo', async () => {
    const withoutSession: ShipCaller = { shipId: console.shipId, fleetId: console.fleetId, kind: console.kind, scopes: console.scopes };

    await expect(setOperatorLogin(withoutSession, NEW_LOGIN)).resolves.toMatchObject({ isOk: false, error: { kind: 'NOT_THE_OPERATOR_SHIP' } });
  });
});
