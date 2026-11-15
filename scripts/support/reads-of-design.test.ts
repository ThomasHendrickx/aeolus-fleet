import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { readsOfDesign } from './reads-of-design.ts';

const design = readFileSync(new URL('../../docs/design/performance/performance.md', import.meta.url), 'utf8');

describe('the reads of the performance design', () => {
  it('are the rows of its table of reads, each with the credential it takes and its input', () => {
    const reads = readsOfDesign(
      ['# Design', '', '## The reads', '', '| Read | Credential | Input |', '|---|---|---|', '| `fleet.health` | fleet | |', '| `fleet.list` | fleet | `{"limit":20}` |', '| `console.session` | session | |', '', 'After.'].join('\n'),
    );
    expect(reads).toEqual([
      { name: 'fleet.health', procedure: 'fleet.health', credential: 'fleet' },
      { name: 'fleet.list', procedure: 'fleet.list', input: { limit: 20 }, credential: 'fleet' },
      { name: 'console.session', procedure: 'console.session', credential: 'session' },
    ]);
  });

  it('are refused when the design has no table of reads, rather than measuring none', () => {
    expect(() => readsOfDesign('# Design\n\nNothing here.')).toThrow('table of reads');
  });

  it('hold every read the console pages, the header and an installation caller make, as the design is now', () => {
    const names = readsOfDesign(design).map((read) => read.name);
    expect(names).toEqual(
      expect.arrayContaining([
        'fleet.health',
        'fleet.stuckCount',
        'fleet.stuck',
        'fleet.stuckHistory',
        'fleet.list',
        'fleet.listedShip',
        'fleet.shipTimeline',
        'fleet.shipMessages',
        'fleet.message',
        'fleet.inbox',
        'fleet.needsAttention',
        'console.session',
        'installation.fleets.list',
        'installation.fleets.get',
      ]),
    );
    expect(new Set(names).size).toBe(names.length);
  });
});
