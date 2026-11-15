import { describe, expect, it } from 'vitest';

import { runReads } from './run-reads.ts';

const target = { url: 'https://staging.example', fleetToken: 'crew-secret', installationToken: 'install-secret', fleetId: 'flt_01abc', consoleSession: 'session-secret' };

const health = { name: 'fleet.health', procedure: 'fleet.health', credential: 'fleet' } as const;
const listedShip = { name: 'fleet.listedShip', procedure: 'fleet.listedShip', input: { shipId: '<ship id>' }, credential: 'fleet' } as const;
const fleetGet = { name: 'installation.fleets.get', procedure: 'installation.fleets.get', input: { fleetId: '<fleet id>' }, credential: 'installation' } as const;
const session = { name: 'console.session', procedure: 'console.session', credential: 'session' } as const;

/** A fleet that answers each procedure after its own time, and refuses a read of a ship or a credential it does not know. */
function fakeFleet(milliseconds: Record<string, number>, ships: string[] = ['shp_01aaa']) {
  let now = 0;
  const fetcher = (request: { url: string; headers: Record<string, string> }) => {
    const { pathname, searchParams } = new URL(request.url);
    const procedure = pathname.replace('/trpc/', '');
    now += milliseconds[procedure] ?? 10;
    const input = JSON.parse(searchParams.get('input') ?? 'null') as { shipId?: string; fleetId?: string } | null;
    if (procedure === 'fleet.list') {
      return Promise.resolve({ isOk: true, body: { result: { data: { items: ships.map((id) => ({ id })), nextCursor: null } } } });
    }
    if (procedure === 'fleet.listedShip') {
      return Promise.resolve({ isOk: input?.shipId !== undefined && ships.includes(input.shipId), body: {} });
    }
    if (procedure === 'installation.fleets.get') {
      return Promise.resolve({ isOk: input?.fleetId === 'flt_01abc' && request.headers['x-aeolus-installation-token'] === 'install-secret', body: {} });
    }
    if (procedure === 'console.session') {
      return Promise.resolve({ isOk: request.headers.cookie === 'aeolus_session=session-secret', body: {} });
    }
    return Promise.resolve({ isOk: request.headers.authorization === 'Bearer crew-secret', body: {} });
  };
  return { fetcher, clock: () => now };
}

const run = { samples: 3, warmup: 1 };

describe('a run over a fleet answer', () => {
  it('reports each read against the budget and beside its S1 baseline', async () => {
    const { fetcher, clock } = fakeFleet({ 'fleet.health': 40, 'fleet.listedShip': 20, 'installation.fleets.get': 30, 'console.session': 15 });
    const report = await runReads({
      ...run,
      reads: [health, listedShip, fleetGet, session],
      target,
      baseline: {
        'fleet.health': { p95Ms: 2100, p99Ms: 3000, errorRate: 0.1 },
        'fleet.listedShip': { p95Ms: 300, p99Ms: 400, errorRate: 0 },
        'installation.fleets.get': { p95Ms: 6400, p99Ms: 7000, errorRate: 0 },
        'console.session': { p95Ms: 1300, p99Ms: 1500, errorRate: 0 },
      },
      fetcher,
      clock,
    });
    expect(report).toContain('| fleet.health | 2100 ms to 40 ms | 3000 ms to 40 ms | 10% to 0% | within |');
    expect(report).toContain('| fleet.listedShip | 300 ms to 20 ms | 400 ms to 20 ms | 0% to 0% | within |');
    expect(report).toContain('| installation.fleets.get | 6400 ms to 30 ms | 7000 ms to 30 ms | 0% to 0% | within |');
    expect(report).toContain('| console.session | 1300 ms to 15 ms | 1500 ms to 15 ms | 0% to 0% | within |');
    expect(report).toContain('0 of 4 reads are over the budget');
  });

  it('flags a read over the budget by each limit it reaches, and does not refuse the run', async () => {
    const { fetcher, clock } = fakeFleet({ 'fleet.health': 650 });
    const report = await runReads({ ...run, reads: [health, session], target, baseline: {}, fetcher, clock });
    expect(report).toContain('| fleet.health | 650 ms (no baseline) | 650 ms | 0% | over: p95, p99 |');
    expect(report).toContain('1 of 2 reads are over the budget');
  });

  it('counts a read the fleet answers with an error as errors, and flags it', async () => {
    const { fetcher, clock } = fakeFleet({});
    const report = await runReads({ ...run, reads: [health], target: { ...target, fleetToken: 'wrong' }, baseline: {}, fetcher, clock });
    expect(report).toContain('over: errors');
  });

  it('names each read that has no S1 baseline entry, and every read when there is no baseline at all', async () => {
    const { fetcher, clock } = fakeFleet({});
    const partial = await runReads({
      ...run,
      reads: [health, session],
      target,
      baseline: { 'fleet.health': { p95Ms: 2100, p99Ms: 3000, errorRate: 0 } },
      fetcher,
      clock,
    });
    expect(partial).toContain('No S1 baseline for: console.session');
    expect(partial).not.toContain('No S1 baseline for: fleet.health');

    const none = await runReads({ ...run, reads: [health, session], target, baseline: {}, fetcher, clock });
    expect(none).toContain('No S1 baseline for: fleet.health, console.session');
    expect(none).toContain('| console.session | 10 ms (no baseline) |');
  });

  it('says a read of a ship could not be measured when the fleet has no ship, and measures the others', async () => {
    const { fetcher, clock } = fakeFleet({}, []);
    const report = await runReads({ ...run, reads: [health, listedShip], target, baseline: {}, fetcher, clock });
    expect(report).toContain('| fleet.listedShip | not measured: the fleet has no ship to read |');
    expect(report).toContain('| fleet.health |');
    expect(report).toContain('1 of 2 reads are not measured');
  });
});
