import { describe, expect, it } from 'vitest';

import { paletteListSchema } from './palette-list.js';

const yourFleet = { kind: 'page', key: 'fleet', label: 'Your fleet', path: '/fleet', keywords: [], rights: ['fleet:read'], icon: 'lock' };

describe("an app's palette list (header-across-apps A1, header design H4)", () => {
  it('takes pages and actions with the rights each needs, and a value to copy', () => {
    const list = { app: 'gateway', entries: [yourFleet, { kind: 'copy', key: 'mcp-address', label: 'Copy MCP address', value: 'https://gateway.acme.example/mcp', keywords: ['mcp'], rights: [], icon: 'copy' }] };

    expect(paletteListSchema.parse(list)).toEqual(list);
  });

  it.each(['https://evil.example/fleet', '//evil.example/fleet', 'fleet'])('refuses an entry that leads off its own app: %s', (path) => {
    expect(paletteListSchema.safeParse({ app: 'gateway', entries: [{ ...yourFleet, path }] }).success).toBe(false);
  });

  it('takes an icon it does not know as the app icon, so a newer app list still reads', () => {
    expect(paletteListSchema.parse({ app: 'gateway', entries: [{ ...yourFleet, icon: 'sparkles' }] }).entries[0]?.icon).toBe('app');
  });
});
