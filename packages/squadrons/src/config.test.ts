import { describe, expect, it } from 'vitest';

import { ConfigError, loadConfig } from './config.js';

const environment = {
  DATABASE_URL: 'postgres://squadrons@localhost:5432/squadrons',
  FLEET_URL: 'https://fleet.example.com',
};

describe('loadConfig', () => {
  it('reads the database and the fleet, and listens on 127.0.0.1:4100 by default', () => {
    expect(loadConfig(environment)).toEqual({
      databaseUrl: environment.DATABASE_URL,
      fleetUrl: 'https://fleet.example.com',
      host: '127.0.0.1',
      port: 4100,
      logLevel: 'info',
      installationToken: undefined,
    });
  });

  it('reads the installation token, which turns on the installation procedures', () => {
    expect(loadConfig({ ...environment, INSTALLATION_TOKEN: 'x'.repeat(32) }).installationToken).toBe('x'.repeat(32));
  });

  it('reads no management ship and no secret: the operator connects squadrons in the console', () => {
    const configured = loadConfig({ ...environment, MANAGEMENT_SHIP_ID: 'shp_01m3tbfspe96yf1rnr4ank9h1a', MANAGEMENT_SHIP_SECRET: 'aeolus_sk_v1_secret' });

    expect(JSON.stringify(configured)).not.toContain('aeolus_sk_v1_secret');
  });

  it.each([
    ['no database', { ...environment, DATABASE_URL: undefined }],
    ['a fleet URL that is not http', { ...environment, FLEET_URL: 'ftp://fleet.example.com' }],
    ['an installation token shorter than 32 characters', { ...environment, INSTALLATION_TOKEN: 'x'.repeat(31) }],
  ])('refuses %s', (_label, invalid) => {
    expect(() => loadConfig(invalid)).toThrow(ConfigError);
  });
});
