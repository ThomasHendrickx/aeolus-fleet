import { describe, expect, it } from 'vitest';

import { createIdGenerator } from '../ids/index.js';
import { accountIdSchema, type AppsList } from '../index.js';
import { appSwitcherOf, signedInAsOf } from './apps.js';

const newId = createIdGenerator();
const ACME = newId('fleet');
const LABS = newId('fleet');
const EMPTY = newId('fleet');

/** Charlotte's list: Account outside any fleet; Acme with the console and the gateway, Labs with the gateway only. */
function charlottesList(overrides: Partial<AppsList> = {}): AppsList {
  return {
    account: { id: accountIdSchema.parse('acc-charlotte'), email: 'charlotte@acme.example' },
    apps: [{ app: 'account', url: 'https://account.example/account' }],
    fleets: [
      {
        id: ACME,
        name: 'Acme',
        argo: false,
        apps: [
          { app: 'console', url: 'https://fleet.example' },
          { app: 'gateway', url: 'https://gateway.example' },
        ],
      },
      { id: LABS, name: 'Labs', argo: false, apps: [{ app: 'gateway', url: 'https://gateway.example' }] },
    ],
    ...overrides,
  };
}

describe('the switcher in the title (header design H1, H8, H9)', () => {
  it('names the fleet in view and the app open', () => {
    const switcher = appSwitcherOf({ list: charlottesList(), fleet: { id: ACME, name: 'Acme' }, app: 'console' });

    expect({ fleet: switcher.fleet.name, app: switcher.appLabel }).toEqual({ fleet: 'Acme', app: 'Console' });
  });

  it('lists every fleet of the account, the one in view marked', () => {
    const switcher = appSwitcherOf({ list: charlottesList(), fleet: { id: ACME, name: 'Acme' }, app: 'console' });

    expect(switcher.fleets.map(({ name, isCurrent }) => ({ name, isCurrent }))).toEqual([
      { name: 'Acme', isCurrent: true },
      { name: 'Labs', isCurrent: false },
    ]);
  });

  it('lists the apps of the fleet in view, then those outside any fleet, the open one marked', () => {
    const switcher = appSwitcherOf({ list: charlottesList(), fleet: { id: ACME, name: 'Acme' }, app: 'console' });

    expect(switcher.apps.map(({ label, url, isCurrent }) => ({ label, url, isCurrent }))).toEqual([
      { label: 'Console', url: 'https://fleet.example', isCurrent: true },
      { label: 'Gateway', url: 'https://gateway.example', isCurrent: false },
      { label: 'Account', url: 'https://account.example/account', isCurrent: false },
    ]);
  });

  it('switches fleet to the same app there when the account may open it', () => {
    const switcher = appSwitcherOf({ list: charlottesList(), fleet: { id: LABS, name: 'Labs' }, app: 'gateway' });

    expect(switcher.fleets.find(({ name }) => name === 'Acme')?.url).toBe('https://gateway.example');
  });

  it('switches fleet to the first app it may open there when it may not open this one', () => {
    const switcher = appSwitcherOf({ list: charlottesList(), fleet: { id: ACME, name: 'Acme' }, app: 'console' });

    expect(switcher.fleets.find(({ name }) => name === 'Labs')?.url).toBe('https://gateway.example');
  });

  it('switches fleet to Account when it may open no app there', () => {
    const list = charlottesList({ fleets: [...charlottesList().fleets, { id: EMPTY, name: 'Empty', argo: false, apps: [] }] });
    const switcher = appSwitcherOf({ list, fleet: { id: ACME, name: 'Acme' }, app: 'console' });

    expect(switcher.fleets.find(({ name }) => name === 'Empty')?.url).toBe('https://account.example/account');
  });

  it('switches nothing without a list: the fleet in view and the app open alone (H8)', () => {
    const switcher = appSwitcherOf({ list: undefined, fleet: { id: ACME, name: 'Acme' }, app: 'console' });

    expect({ canSwitch: switcher.canSwitch, fleets: switcher.fleets.length, apps: switcher.apps.length }).toEqual({ canSwitch: false, fleets: 1, apps: 1 });
  });

  it('switches when the list offers a second fleet or a second app', () => {
    expect(appSwitcherOf({ list: charlottesList(), fleet: { id: ACME, name: 'Acme' }, app: 'console' }).canSwitch).toBe(true);
  });
});

describe('how you are signed in here (header design H10)', () => {
  it('says each way of signing in', () => {
    expect([signedInAsOf('argo'), signedInAsOf('account'), signedInAsOf('viewer')]).toEqual(['Signed in as argo', 'Signed in as your account', 'Viewer']);
  });
});
