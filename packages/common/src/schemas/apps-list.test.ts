import { describe, expect, it } from 'vitest';

import { createIdGenerator } from '../ids/index.js';
import { appsListSchema } from './apps-list.js';

const newId = createIdGenerator();
const acmeId = newId('fleet');

function anAnswer(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    account: { id: 'acc-charlotte', email: 'charlotte@acme.example' },
    apps: [{ app: 'account', url: 'https://account.example/account' }],
    fleets: [{ id: acmeId, name: 'Acme', argo: false, apps: [{ app: 'console', url: 'https://fleet.example' }] }],
    ...overrides,
  };
}

describe('appsListSchema (header design H1)', () => {
  it('reads the account, its apps outside any fleet and its fleets with the apps in each', () => {
    expect(appsListSchema.parse(anAnswer())).toEqual({
      account: { id: 'acc-charlotte', email: 'charlotte@acme.example' },
      apps: [{ app: 'account', url: 'https://account.example/account' }],
      fleets: [{ id: acmeId, name: 'Acme', argo: false, apps: [{ app: 'console', url: 'https://fleet.example' }] }],
    });
  });

  it('refuses an app it does not know', () => {
    expect(appsListSchema.safeParse(anAnswer({ apps: [{ app: 'billing', url: 'https://billing.example' }] })).success).toBe(false);
  });

  it('refuses an address that is not an http(s) URL', () => {
    expect(appsListSchema.safeParse(anAnswer({ apps: [{ app: 'account', url: 'javascript:alert(1)' }] })).success).toBe(false);
  });

  it('reads a console at a local address, as the console the e2e fleet switch opens in place runs (docs/design/app-navigation, open a fleet)', () => {
    // Given the account app naming the console at a local address with its port
    const answer = anAnswer({ fleets: [{ id: acmeId, name: 'Acme', argo: false, apps: [{ app: 'console', url: 'http://localhost:21001' }] }] });

    // When the app's server reads the list
    const read = appsListSchema.safeParse(answer);

    // Then the list holds that console, so the panel offers the fleet
    expect(read.data?.fleets[0]?.apps).toEqual([{ app: 'console', url: 'http://localhost:21001' }]);
  });

  it('refuses a fleet without an id', () => {
    expect(appsListSchema.safeParse(anAnswer({ fleets: [{ id: 'acme', name: 'Acme', argo: false, apps: [] }] })).success).toBe(false);
  });
});
