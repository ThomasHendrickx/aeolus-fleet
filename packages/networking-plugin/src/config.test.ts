import { describe, expect, it } from 'vitest';

import { ConfigError, loadConfig } from './config.js';

const environment = {
  DATABASE_URL: 'postgres://networking@localhost:5432/networking_plugin',
  FLEET_URL: 'https://fleet.example.com',
};

describe('loadConfig', () => {
  it('reads the database and the fleet, and listens on 127.0.0.1:4300 by default', () => {
    expect(loadConfig(environment)).toEqual({
      databaseUrl: environment.DATABASE_URL,
      fleetUrl: 'https://fleet.example.com',
      host: '127.0.0.1',
      port: 4300,
      logLevel: 'info',
      installationToken: undefined,
      supplyRetryMs: 10_000,
    });
  });

  it('reads how often a supply the fleet refused is tried again, in seconds', () => {
    expect(loadConfig({ ...environment, SUPPLY_RETRY_SECONDS: '30' }).supplyRetryMs).toBe(30_000);
  });

  it('reads the installation token, which turns on the installation procedures', () => {
    expect(loadConfig({ ...environment, INSTALLATION_TOKEN: 'x'.repeat(32) }).installationToken).toBe('x'.repeat(32));
  });

  it('reads no ship and no secret: the operator connects the networking plugin in the console', () => {
    const configured = loadConfig({ ...environment, PLUGIN_SHIP_ID: 'shp_01m3tbfspe96yf1rnr4ank9h1a', PLUGIN_SHIP_SECRET: 'aeolus_sk_v1_secret' });

    expect(JSON.stringify(configured)).not.toContain('aeolus_sk_v1_secret');
  });

  it.each([
    ['no database', { ...environment, DATABASE_URL: undefined }],
    ['a fleet URL that is not http', { ...environment, FLEET_URL: 'ftp://fleet.example.com' }],
    ['an installation token shorter than 32 characters', { ...environment, INSTALLATION_TOKEN: 'x'.repeat(31) }],
    ['a supply retry of no seconds', { ...environment, SUPPLY_RETRY_SECONDS: '0' }],
  ])('refuses %s', (_label, invalid) => {
    expect(() => loadConfig(invalid)).toThrow(ConfigError);
  });
});
