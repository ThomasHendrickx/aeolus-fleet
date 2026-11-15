import { describe, expect, it } from 'vitest';

import { createIdGenerator } from '../ids/index.js';
import { accountIdSchema } from '../schemas/account-token.js';
import type { AppsList } from '../schemas/apps-list.js';
import type { PaletteList } from '../schemas/palette-list.js';
import { otherAppsPaletteOf, paletteEntryMatches, paletteOriginsOf, type ReadPaletteList } from './palette-across-apps.js';

const newId = createIdGenerator();
const fleetId = newId('fleet');

const CONSOLE_URL = 'https://console.acme.example/';
const GATEWAY_URL = 'https://gateway.acme.example/';
const ACCOUNT_URL = 'https://account.acme.example/';

/** The apps list of an account that may open the console and the gateway in its fleet, and Account. */
function anAppsList(fleetApps: AppsList['fleets'][number]['apps'] = [{ app: 'console', url: CONSOLE_URL }, { app: 'gateway', url: GATEWAY_URL }]): AppsList {
  return {
    account: { id: accountIdSchema.parse('acc-sam'), email: 'sam@acme.example' },
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
const yourFleet = { kind: 'page', key: 'fleet', label: 'Your fleet', path: '/fleet', keywords: [], rights: [], icon: 'lock' } satisfies PaletteList['entries'][number];
const mcpAddress = { kind: 'copy', key: 'mcp-address', label: 'Copy MCP address', value: 'https://gateway.acme.example/mcp', keywords: ['mcp'], rights: [], icon: 'copy' } satisfies PaletteList['entries'][number];
const gatewayList: PaletteList = { app: 'gateway', entries: [yourFleet, mcpAddress] };
const accountList: PaletteList = {
  app: 'account',
  entries: [{ kind: 'page', key: 'rights', label: 'Your rights', path: '/rights', keywords: [], rights: [], icon: 'shield' }],
};

/** Each list as read from its app's origin. */
const READ: readonly ReadPaletteList[] = [
  { origin: new URL(CONSOLE_URL).origin, list: consoleList },
  { origin: new URL(GATEWAY_URL).origin, list: gatewayList },
  { origin: new URL(ACCOUNT_URL).origin, list: accountList },
];

describe('the palette across apps (header-across-apps A1 to A3, M2)', () => {
  it("shows each other app's pages and actions under the app's name, opening in the fleet in view", () => {
    // Given an account in the console that may open the gateway and Account
    const list = anAppsList();
    // When the console's server filters the other apps' lists
    const groups = otherAppsPaletteOf({ list, fleetId, openApp: 'console', paletteLists: READ });
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
    const groups = otherAppsPaletteOf({ list, fleetId, openApp: 'account', paletteLists: READ });
    // Then only the console's group shows
    expect(groups.map((group) => group.app)).toEqual(['console']);
  });

  it('shows an app whose list could not be read by its name alone, opening it', () => {
    // Given the gateway's list could not be read
    const list = anAppsList();
    // When the console's server filters what it has
    const groups = otherAppsPaletteOf({ list, fleetId, openApp: 'console', paletteLists: READ.filter(({ list }) => list.app === 'account') });
    // Then the gateway shows by name, opening in this fleet
    expect(groups[0]).toEqual({ app: 'gateway', label: 'Gateway', entries: [{ key: 'gateway:app', label: 'Gateway', keywords: [], icon: 'app', href: `https://gateway.acme.example/?fleet=${fleetId}` }] });
  });

  it('shows nothing of other apps without an apps list (argo, the viewer, self-hosted)', () => {
    expect(otherAppsPaletteOf({ list: undefined, fleetId, openApp: 'console', paletteLists: READ })).toEqual([]);
  });

  it('shows an account only the entries whose rights it holds: no Compose or Commission, which an account cannot open (A1, A2)', () => {
    // Given the console's list holds Compose (messages:send), Commission ship (fleet:manage) and Fleet overview (fleet:read)
    const withActions: PaletteList = {
      app: 'console',
      entries: [
        { kind: 'action', key: 'compose', label: 'Compose a message', path: '/?compose=new', keywords: [], rights: ['messages:send'], icon: 'send' },
        ...consoleList.entries,
      ],
    };
    // When the gateway's server filters it for an account that may open the console (fleet:read)
    const groups = otherAppsPaletteOf({ list: anAppsList(), fleetId, openApp: 'gateway', paletteLists: [{ origin: new URL(CONSOLE_URL).origin, list: withActions }, ...READ.slice(1)] });
    // Then only Fleet overview shows of the console
    expect(groups.find((group) => group.app === 'console')?.entries.map((entry) => entry.key)).toEqual(['console:overview']);
  });

  it('shows no entry needing fleet:read where the apps list does not show the account holds it', () => {
    // Given an account that may open only the gateway in its fleet, whose Your fleet needs fleet:read
    const list = anAppsList([{ app: 'gateway', url: GATEWAY_URL }]);
    const needsRead: PaletteList = { app: 'gateway', entries: [{ ...yourFleet, rights: ['fleet:read'] }, mcpAddress] };
    // When the account app's server filters it
    const groups = otherAppsPaletteOf({ list, fleetId, openApp: 'account', paletteLists: [{ origin: new URL(GATEWAY_URL).origin, list: needsRead }] });
    // Then only Copy MCP address shows
    expect(groups[0]?.entries.map((entry) => entry.key)).toEqual(['gateway:mcp-address']);
  });

  describe('each fleet its own apps (per-fleet origins)', () => {
    const fleetB = newId('fleet');
    const GATEWAY_B_URL = 'https://gateway-b.acme.example/';
    const twoFleets: AppsList = {
      ...anAppsList(),
      fleets: [...anAppsList().fleets, { id: fleetB, name: 'Fleet B', argo: false, apps: [{ app: 'console', url: CONSOLE_URL }, { app: 'gateway', url: GATEWAY_B_URL }] }],
    };
    const gatewayBList: PaletteList = { app: 'gateway', entries: [{ ...mcpAddress, value: 'https://gateway-b.acme.example/mcp' }] };
    const read: readonly ReadPaletteList[] = [...READ, { origin: new URL(GATEWAY_B_URL).origin, list: gatewayBList }];

    it("reads only the lists of the fleet in view's apps and those outside any fleet", () => {
      expect(paletteOriginsOf({ list: twoFleets, fleetId: fleetB, openApp: 'console' })).toEqual(['https://gateway-b.acme.example', 'https://account.acme.example']);
    });

    it("shows fleet B its own gateway's Copy MCP address, never gateway-a's", () => {
      const groups = otherAppsPaletteOf({ list: twoFleets, fleetId: fleetB, openApp: 'console', paletteLists: read });
      expect(groups.find((group) => group.app === 'gateway')?.entries).toEqual([
        { key: 'gateway:mcp-address', label: 'Copy MCP address', keywords: ['mcp'], icon: 'copy', copyText: 'https://gateway-b.acme.example/mcp' },
      ]);
    });

    it("shows fleet B's gateway by its name alone while its list could not be read, never gateway-a's list", () => {
      const groups = otherAppsPaletteOf({ list: twoFleets, fleetId: fleetB, openApp: 'console', paletteLists: READ });
      expect(groups.find((group) => group.app === 'gateway')?.entries).toEqual([{ key: 'gateway:app', label: 'Gateway', keywords: [], icon: 'app', href: `https://gateway-b.acme.example/?fleet=${fleetB}` }]);
    });

    it('takes no list an origin serves for another app', () => {
      // Given the gateway's origin answers a list that says it is Account's
      const groups = otherAppsPaletteOf({ list: anAppsList(), fleetId, openApp: 'console', paletteLists: [{ origin: new URL(GATEWAY_URL).origin, list: accountList }] });
      // Then the gateway shows by name, and Account by name too
      expect(groups.map((group) => group.entries.map((entry) => entry.key))).toEqual([['gateway:app'], ['account:app']]);
    });
  });

  it.each(['//evil.example/fleet', '/\\evil.example/fleet', '/\n/evil.example/fleet', '/\t/evil.example/fleet', '/\r/evil.example/fleet', '\\/evil.example/fleet', 'https://evil.example/fleet'])(
    'drops an entry whose destination leaves its app: %j',
    (path) => {
      // Given the gateway's list holds an entry leading off the gateway, as an unchecked list might
      const offApp = { app: 'gateway', entries: [{ ...yourFleet, path }] } satisfies PaletteList;
      // When the console's server filters it
      const groups = otherAppsPaletteOf({ list: anAppsList(), fleetId, openApp: 'console', paletteLists: [{ origin: new URL(GATEWAY_URL).origin, list: offApp }] });
      // Then the entry is not shown
      expect(groups.find((group) => group.app === 'gateway')?.entries).toEqual([]);
    },
  );

  it('finds an entry by its label or keywords, in any case', () => {
    const copy = { label: 'Copy MCP address', keywords: ['mcp', 'address'] };
    expect([paletteEntryMatches(copy, 'MCP'), paletteEntryMatches(copy, ' copy '), paletteEntryMatches(copy, 'rights')]).toEqual([true, true, false]);
  });
});
