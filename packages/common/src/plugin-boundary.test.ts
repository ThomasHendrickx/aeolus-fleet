import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { createPluginBoundary, type PluginBoundaryRequest } from './plugin-boundary.js';
import type { PluginCallContext } from './schemas/plugin-call.js';

const CURRENT = 'current-secret-for-plugin-test-only';
const NEXT = 'next-secret-for-plugin-test-only-000';
const context: PluginCallContext = {
  requestId: 'f473fb19-52cd-445f-906b-7d6ef5e4b01f',
  fleetId: 'flt_00000000000000000000000001', pluginShipId: 'shp_00000000000000000000000002',
  actor: { kind: 'ship', shipId: 'shp_00000000000000000000000003' },
  scopes: ['sample:change'], procedure: 'widgets.change', input: { value: 1 }, expiresAt: '2026-11-16T12:00:30.000Z',
};

/** A thin plugin's durable atomic reservation, independent of a process's lifetime. */
async function plugin() {
  const directory = await mkdtemp(join(tmpdir(), 'plugin-contract-'));
  const changes: unknown[] = [];
  let now = new Date('2026-11-16T12:00:00.000Z');
  const restart = (secrets = [CURRENT, NEXT]) => createPluginBoundary({
    pluginShipId: context.pluginShipId, secrets, now: () => now,
    serves: (fleetId) => Promise.resolve(fleetId === context.fleetId),
    reservations: { reserve: async (dispatch) => {
      try {
        await writeFile(join(directory, `${dispatch.fleetId}-${dispatch.pluginShipId}-${dispatch.requestId}`), JSON.stringify(dispatch), { flag: 'wx' });
        return true;
      } catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'EEXIST') return false;
        throw error;
      }
    } },
    procedures: { 'widgets.change': (verified) => {
      if (!verified.scopes.includes('sample:change')) return Promise.resolve({ error: { data: { code: 'FORBIDDEN' } } });
      changes.push({ actor: verified.actor, input: verified.input, requestId: verified.requestId });
      return Promise.resolve({ result: { data: { version: changes.length } } });
    } },
  });
  return { restart, changes, expire: () => { now = new Date(context.expiresAt); }, close: () => rm(directory, { recursive: true, force: true }) };
}
const request = (body: unknown = context, secret: string | undefined = CURRENT): PluginBoundaryRequest => ({ body, secret, isInternal: true, isPublic: false });

describe('plugin actor contract slice 1: verified boundary', () => {
  it('accepts the current and next secret during rotation and drops the old secret after restart', async () => {
    // Given a plugin accepting both deployment secrets.
    const fixture = await plugin();
    try {
      // When core switches to the next secret and the plugin then drops the old one.
      const first = await fixture.restart()(request());
      const secondContext = { ...context, requestId: 'f473fb19-52cd-445f-906b-7d6ef5e4b020' };
      const second = await fixture.restart()(request(secondContext, NEXT));
      const old = await fixture.restart([NEXT])(request({ ...context, requestId: 'f473fb19-52cd-445f-906b-7d6ef5e4b021' }));
      // Then both phases execute once and the retired secret executes nothing.
      expect([first, second, old]).toEqual([{ result: { data: { version: 1 } } }, { result: { data: { version: 2 } } }, { error: { data: { code: 'UNAUTHORIZED' } } }]);
      expect(fixture.changes).toHaveLength(2);
    } finally { await fixture.close(); }
  });

  it('executes concurrent copies at most once, retains reservations across restart and rejects changed or expired replays', async () => {
    // Given a durable reservation shared by plugin processes.
    const fixture = await plugin();
    try {
      // When duplicates race, the plugin restarts, and the context is changed or expires.
      const boundary = fixture.restart();
      const race = await Promise.all([boundary(request()), boundary(request())]);
      const replay = await fixture.restart()(request({ ...context, input: { value: 2 } }));
      fixture.expire();
      const expired = await fixture.restart()(request());
      // Then exactly one operation executed, without forgetting the live reservation.
      expect(race).toContainEqual({ result: { data: { version: 1 } } });
      expect(race).toContainEqual({ error: { data: { code: 'CONFLICT' } } });
      expect(replay).toEqual({ error: { data: { code: 'CONFLICT' } } });
      expect(expired).toEqual({ error: { data: { code: 'UNAUTHORIZED' } } });
      expect(fixture.changes).toEqual([{ actor: context.actor, input: { value: 1 }, requestId: context.requestId }]);
    } finally { await fixture.close(); }
  });

  it.each(([
    ['missing secret', { ...request(), secret: undefined }, 'UNAUTHORIZED'],
    ['wrong secret', request(context, 'wrong'), 'UNAUTHORIZED'],
    ['public endpoint', { ...request(), isPublic: true }, 'UNAUTHORIZED'],
    ['outside internal network', { ...request(), isInternal: false }, 'UNAUTHORIZED'],
    ['wrong fleet', request({ ...context, fleetId: 'flt_00000000000000000000000004' }), 'PRECONDITION_FAILED'],
    ['wrong plugin', request({ ...context, pluginShipId: 'shp_00000000000000000000000004' }), 'UNAUTHORIZED'],
    ['expired context', request({ ...context, expiresAt: '2026-11-16T11:59:59.000Z' }), 'UNAUTHORIZED'],
    ['unexposed procedure', request({ ...context, procedure: 'installation.delete' }), 'NOT_FOUND'],
    ['missing plugin scope', request({ ...context, scopes: ['fleet:manage', 'trierarch:join'] }), 'FORBIDDEN'],
  ] satisfies [string, ReturnType<typeof request>, string][]).map((entry) => {
    const [name, input, code] = entry;
    return { name, input, code };
  }))('refuses $name without executing', async ({ input, code }) => {
    // Given a connected thin plugin.
    const fixture = await plugin();
    try {
      // When an untrusted or unauthorized dispatch arrives.
      const answer = await fixture.restart()(input);
      // Then no change executes.
      expect(answer).toEqual({ error: { data: { code } } });
      expect(fixture.changes).toEqual([]);
    } finally { await fixture.close(); }
  });
});
