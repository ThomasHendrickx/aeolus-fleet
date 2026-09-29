import { describe, expect, it } from 'vitest';

import { ConfigError, loadConfig } from './config.js';

const databaseUrl = 'postgresql://aeolus:s3cret@localhost:5432/aeolus';

describe('loadConfig', () => {
  it('applies defaults for everything but the database URL', () => {
    expect(loadConfig({ DATABASE_URL: databaseUrl })).toEqual({
      databaseUrl,
      host: '127.0.0.1',
      port: 4000,
      logLevel: 'info',
      trustProxy: false,
    });
  });

  it('trusts a reverse proxy only when told to', () => {
    expect(loadConfig({ DATABASE_URL: databaseUrl, TRUST_PROXY: 'true' }).trustProxy).toBe(true);
    expect(loadConfig({ DATABASE_URL: databaseUrl, TRUST_PROXY: 'false' }).trustProxy).toBe(false);
    expect(() => loadConfig({ DATABASE_URL: databaseUrl, TRUST_PROXY: 'yes' })).toThrow(/TRUST_PROXY/);
  });

  it('reads host, port and log level', () => {
    const config = loadConfig({ DATABASE_URL: databaseUrl, HOST: '0.0.0.0', PORT: '8080', LOG_LEVEL: 'debug' });

    expect(config).toMatchObject({ host: '0.0.0.0', port: 8080, logLevel: 'debug' });
  });

  it('names a missing database URL', () => {
    expect(() => loadConfig({})).toThrow(ConfigError);
    expect(() => loadConfig({})).toThrow(/DATABASE_URL/);
  });

  it('rejects a database URL that is not Postgres', () => {
    expect(() => loadConfig({ DATABASE_URL: 'mysql://aeolus:s3cret@localhost/aeolus' })).toThrow(/DATABASE_URL/);
  });

  it('names every invalid variable at once', () => {
    expect(() => loadConfig({ PORT: 'eighty', LOG_LEVEL: 'loud' })).toThrow(/DATABASE_URL[\s\S]*PORT[\s\S]*LOG_LEVEL/);
  });

  it('never echoes a value, so a password cannot leak', () => {
    const message = errorMessageOf(() => loadConfig({ DATABASE_URL: 'mysql://aeolus:s3cret@localhost/aeolus' }));

    expect(message).toContain('DATABASE_URL');
    expect(message).not.toContain('s3cret');
  });
});

function errorMessageOf(action: () => unknown): string {
  try {
    action();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error('expected the action to throw');
}
