import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { webVersion } from './version';

const serverSays = (status: number, body: unknown) => () => Promise.resolve(Response.json(body, { status }));
const SERVER = { server: '0.7.0', common: '0.7.0', migration: '20261001040000_lease_last_seen' };

describe('webVersion', () => {
  it("answers the web app's own version, from its package", async () => {
    const own = z.object({ version: z.string() }).parse(JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')));

    await expect(webVersion({ fetchServerVersion: serverSays(200, SERVER) })).resolves.toMatchObject({ web: own.version });
  });

  it("passes on the server's own answer, so versions out of step show", async () => {
    const halfway = { server: '0.6.0', common: '0.6.0', migration: '20261001020000_console_session_end_reason' };

    await expect(webVersion({ fetchServerVersion: serverSays(200, halfway), web: '0.7.0' })).resolves.toEqual({ web: '0.7.0', server: halfway });
  });

  it('answers no server when it does not answer, or answers something else', async () => {
    await expect(webVersion({ fetchServerVersion: () => Promise.reject(new TypeError('fetch failed')), web: '0.7.0' })).resolves.toEqual({
      web: '0.7.0',
      server: null,
    });
    await expect(webVersion({ fetchServerVersion: serverSays(200, { fleets: 3 }), web: '0.7.0' })).resolves.toEqual({ web: '0.7.0', server: null });
    await expect(webVersion({ fetchServerVersion: serverSays(502, SERVER), web: '0.7.0' })).resolves.toEqual({ web: '0.7.0', server: null });
  });

  it('has no squadrons part when the console has no squadrons', async () => {
    const answer = await webVersion({ fetchServerVersion: serverSays(200, SERVER), web: '0.7.0' });

    expect(Object.keys(answer)).toEqual(['web', 'server']);
  });

  it("passes on squadrons' own answer when the console has squadrons", async () => {
    const squadrons = { squadrons: '0.11.0', migration: '20261003100000_formation_attempts', connection: 'connected' };

    await expect(webVersion({ fetchServerVersion: serverSays(200, SERVER), fetchSquadronsVersion: serverSays(200, squadrons), web: '0.7.0' })).resolves.toEqual({
      web: '0.7.0',
      server: SERVER,
      squadrons,
    });
  });

  it('answers squadrons null when squadrons does not answer, and the server part still', async () => {
    await expect(
      webVersion({ fetchServerVersion: serverSays(200, SERVER), fetchSquadronsVersion: () => Promise.reject(new TypeError('fetch failed')), web: '0.7.0' }),
    ).resolves.toEqual({ web: '0.7.0', server: SERVER, squadrons: null });
  });
});
