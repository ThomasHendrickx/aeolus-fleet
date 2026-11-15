import { describe, expect, it } from 'vitest';

import { createIdGenerator } from '../ids/index.js';
import type { AppsList } from '../schemas/apps-list.js';
import type { PaletteList } from '../schemas/palette-list.js';
import { otherAppsPaletteOf, paletteEntryMatches } from './palette-across-apps.js';

const newId = createIdGenerator();
const fleetId = newId('fleet');

const CONSOLE_URL = 'https://console.acme.example/';
const GATEWAY_URL = 'https://gateway.acme.example/';
const ACCOUNT_URL = 'https://account.acme.example/';

/** The apps list of an account that may open the console and the gateway in its fleet, and Account. */
function anAppsList(fleetApps: AppsList['fleets'][number]['apps'] = [{ app: 'console', url: CONSOLE_URL }, { app: 'gateway', url: GATEWAY_URL }]): AppsList {
  return {
    account: { id: 'acc-sam', email: 'sam@acme.example' },
    apps: [{ app: 'account', url: ACCOUNT_URL }],
    fleets: [{ id: fleetId, name: 'Acme fleet', argo: false, apps: fleetApps }],
  };
}

const consoleList: PaletteList = {
  app: 'console',
  entries: [
    { kind: 'action', key: 'commission', label: 'Commission ship', path: '/?commission=new', keywords: [], rights: ['fleet:commission'], icon: 'plus' },
    { kind: 'page', key: 'overview', label: 'Fleet overview', path: '/', keywords: ['ships'], rights: ['fleet:read'], icon: 'ship' },
  ],
};
const gatewayList: PaletteList = {
  app: 'gateway',
  entries: [
    { kind: 'page', key: 'fleet', label: 'Your fleet', path: '/fleet', keywords: [], rights: [], icon: 'lock' },
    { kind: 'copy', key: 'mcp-address', label: 'Copy MCP address', value: 'https://gateway.acme.example/mcp', keywords: ['mcp'], rights: [], icon: 'copy' },
  ],
};
const accountList: PaletteList = {
  app: 'account',
  entries: [{ kind: 'page', key: 'rights', label: 'Your rights', path: '/rights', keywords: [], rights: [], icon: 'shield' }],
};

describe('the palette across apps (header-across-apps A1 to A3, M2)', () => {
  it("shows each other app's pages and actions under the app's name, opening in the fleet in view", () => {
    // Given an account in the console that may open the gateway and Account
    const list = anAppsList();
    // When the console's server filters the other apps' lists
    const groups = otherAppsPaletteOf({ list, fleetId, openApp: 'console', paletteLists: [consoleList, gatewayList, accountList] });
    // Then the gateway's entries open in this fleet, Account's outside any, each under its app's name
    expect(groups).toEqual([
      {
        app: 'gateway',
        label: 'Gateway',
        entries: [
          { key: 'gateway:fleet', label: 'Your fleet', keywords: [], icon: 'lock', href: `https://gateway.acme.example/fleet?fleet=${fleetId}` },
          { key: 'gateway:mcp-address', label: 'Copy MCP address', keywords: ['mcp'], icon: 'copy', copyText: 'https://gateway.acme.example/mcp' },
        ],
      },
      { app: 'account', label: 'Account', entries: [{ key: 'account:rights', label: 'Your rights', keywords: [], icon: 'shield', href: 'https://account.acme.example/rights' }] },
    ]);
  });

  it('shows no app the account may not open, so no Copy MCP address without the gateway', () => {
    // Given an account that may open only the console in its fleet, and Account
    const list = anAppsList([{ app: 'console', url: CONSOLE_URL }]);
    // When the account app's server filters every list it read
    const groups = otherAppsPaletteOf({ list, fleetId, openApp: 'account', paletteLists: [consoleList, gatewayList, accountList] });
    // Then only the console's group shows
    expect(groups.map((group) => group.app)).toEqual(['console']);
  });

  it('shows an app whose list could not be read by its name alone, opening it', () => {
    // Given the gateway's list could not be read
    const list = anAppsList();
    // When the console's server filters what it has
    const groups = otherAppsPaletteOf({ list, fleetId, openApp: 'console', paletteLists: [accountList] });
    // Then the gateway shows by name, opening in this fleet
    expect(groups[0]).toEqual({ app: 'gateway', label: 'Gateway', entries: [{ key: 'gateway:app', label: 'Gateway', keywords: [], icon: 'app', href: `https://gateway.acme.example/?fleet=${fleetId}` }] });
  });

  it('shows nothing of other apps without an apps list (argo, the viewer, self-hosted)', () => {
    expect(otherAppsPaletteOf({ list: undefined, fleetId, openApp: 'console', paletteLists: [gatewayList] })).toEqual([]);
  });

  it('finds an entry by its label or keywords, in any case', () => {
    const copy = { label: 'Copy MCP address', keywords: ['mcp', 'address'] };
    expect([paletteEntryMatches(copy, 'MCP'), paletteEntryMatches(copy, ' copy '), paletteEntryMatches(copy, 'rights')]).toEqual([true, true, false]);
  });
});
