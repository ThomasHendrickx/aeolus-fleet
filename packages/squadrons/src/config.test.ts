import { describe, expect, it } from 'vitest';

import { ConfigError, loadConfig } from './config.js';

const environment = {
  DATABASE_URL: 'postgres://squadrons@localhost:5432/squadrons',
  FLEET_URL: 'https://fleet.example.com',
  MANAGEMENT_SHIP_ID: 'shp_01m3tbfspe96yf1rnr4ank9h1a',
  MANAGEMENT_SHIP_SECRET: 'aeolus_sk_v1_secret',
};

describe('loadConfig', () => {
  it('reads the database, the fleet, the management ship, and listens on 127.0.0.1:4100 by default', () => {
    expect(loadConfig(environment)).toEqual({
      databaseUrl: environment.DATABASE_URL,
      fleetUrl: 'https://fleet.example.com',
      managementShip: { shipId: environment.MANAGEMENT_SHIP_ID, secret: environment.MANAGEMENT_SHIP_SECRET },
      host: '127.0.0.1',
      port: 4100,
      logLevel: 'info',
    });
  });

  it('needs no secret once the management ship is crewed: the kept crew token does', () => {
    const { MANAGEMENT_SHIP_SECRET: _spent, ...withoutSecret } = environment;

    expect(loadConfig(withoutSecret).managementShip).toEqual({ shipId: environment.MANAGEMENT_SHIP_ID, secret: undefined });
  });

  it.each([
    ['no database', { ...environment, DATABASE_URL: undefined }],
    ['a fleet URL that is not http', { ...environment, FLEET_URL: 'ftp://fleet.example.com' }],
    ['a management ship id that is no ship id', { ...environment, MANAGEMENT_SHIP_ID: 'msg_01m3tbfspe96yf1rnr4ank9h1a' }],
  ])('refuses %s', (_label, invalid) => {
    expect(() => loadConfig(invalid)).toThrow(ConfigError);
  });
});
