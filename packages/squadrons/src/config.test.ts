import { describe, expect, it } from 'vitest';

import { ConfigError, loadConfig } from './config.js';

const environment = {
  DATABASE_URL: 'postgres://squadrons@localhost:5432/squadrons',
  FLEET_URL: 'https://fleet.example.com',
  HOME: '/home/squadrons',
};

describe('loadConfig', () => {
  it("reads the database and the fleet, listens on 127.0.0.1:4100 and keeps the mirrors in the user's cache folder by default", () => {
    expect(loadConfig(environment)).toEqual({
      databaseUrl: environment.DATABASE_URL,
      fleetUrl: 'https://fleet.example.com',
      host: '127.0.0.1',
      port: 4100,
      logLevel: 'info',
      cacheDir: '/home/squadrons/.cache/aeolus-squadrons',
    });
  });

  it('keeps the mirrors under XDG_CACHE_HOME when it is set, and where SQUADRONS_CACHE_DIR says when that is set', () => {
    expect(loadConfig({ ...environment, XDG_CACHE_HOME: '/var/cache/squadrons' }).cacheDir).toBe('/var/cache/squadrons/aeolus-squadrons');
    expect(loadConfig({ ...environment, XDG_CACHE_HOME: '/var/cache/squadrons', SQUADRONS_CACHE_DIR: '/srv/mirrors' }).cacheDir).toBe('/srv/mirrors');
  });

  it('reads no management ship and no secret: the operator connects squadrons in the console', () => {
    const configured = loadConfig({ ...environment, MANAGEMENT_SHIP_ID: 'shp_01m3tbfspe96yf1rnr4ank9h1a', MANAGEMENT_SHIP_SECRET: 'aeolus_sk_v1_secret' });

    expect(JSON.stringify(configured)).not.toContain('aeolus_sk_v1_secret');
  });

  it.each([
    ['no database', { ...environment, DATABASE_URL: undefined }],
    ['a fleet URL that is not http', { ...environment, FLEET_URL: 'ftp://fleet.example.com' }],
  ])('refuses %s', (_label, invalid) => {
    expect(() => loadConfig(invalid)).toThrow(ConfigError);
  });
});
