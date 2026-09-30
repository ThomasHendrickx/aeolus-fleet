import { describe, expect, it } from 'vitest';

import { ConfigError, loadConfig } from './config.js';

const databaseUrl = 'postgresql://aeolus:s3cret@localhost:5432/aeolus';
const publicUrl = 'https://fleet.example.com';
const required = { DATABASE_URL: databaseUrl, PUBLIC_URL: publicUrl };

describe('loadConfig', () => {
  it('applies defaults for everything but the database URL and the public URL', () => {
    expect(loadConfig(required)).toEqual({
      databaseUrl,
      publicUrl,
      host: '127.0.0.1',
      port: 4000,
      logLevel: 'info',
      shouldTrustProxy: false,
      cookieDomain: undefined,
      consoleOrigin: publicUrl,
    });
  });

  it("takes the public URL's origin as the console origin when none is configured: web and server behind one host", () => {
    expect(loadConfig({ ...required, PUBLIC_URL: 'https://Fleet.example.com:443/aeolus/' }).consoleOrigin).toBe(
      'https://fleet.example.com',
    );
  });

  it('reads the cookie domain and the console origin, so the console can run on another host under one domain', () => {
    expect(
      loadConfig({ ...required, COOKIE_DOMAIN: 'fleet.example.com', CONSOLE_ORIGIN: 'https://console.fleet.example.com' }),
    ).toMatchObject({ cookieDomain: 'fleet.example.com', consoleOrigin: 'https://console.fleet.example.com' });
  });

  it.each([
    { label: 'a trailing slash', origin: 'http://localhost:3000/', expected: 'http://localhost:3000' },
    { label: 'capitals in the host', origin: 'https://Console.Fleet.example.com', expected: 'https://console.fleet.example.com' },
    { label: 'the default port', origin: 'https://console.fleet.example.com:443', expected: 'https://console.fleet.example.com' },
  ])('takes the console origin with $label as the origin a browser sends', ({ origin, expected }) => {
    expect(loadConfig({ ...required, CONSOLE_ORIGIN: origin }).consoleOrigin).toBe(expected);
  });

  it.each(['https://fleet.example.com', 'fleet.example.com/console', '.fleet.example.com', 'fleet example.com'])(
    'rejects %j as the cookie domain: it is a domain name alone',
    (domain) => {
      expect(() => loadConfig({ ...required, COOKIE_DOMAIN: domain })).toThrow(/COOKIE_DOMAIN/);
    },
  );

  it.each([
    'console.fleet.example.com',
    'ftp://console.fleet.example.com',
    'https://console.fleet.example.com/sign-in',
    'https://console.fleet.example.com/?next=1',
    'https://operator@console.fleet.example.com',
  ])(
    'rejects %j as the console origin: it is an http or https origin without a path',
    (origin) => {
      expect(() => loadConfig({ ...required, CONSOLE_ORIGIN: origin })).toThrow(/CONSOLE_ORIGIN/);
    },
  );

  it('trusts a reverse proxy only when told to', () => {
    expect(loadConfig({ ...required, TRUST_PROXY: 'true' }).shouldTrustProxy).toBe(true);
    expect(loadConfig({ ...required, TRUST_PROXY: 'false' }).shouldTrustProxy).toBe(false);
    expect(() => loadConfig({ ...required, TRUST_PROXY: 'yes' })).toThrow(/TRUST_PROXY/);
  });

  it('reads host, port and log level', () => {
    const config = loadConfig({ ...required, HOST: '0.0.0.0', PORT: '8080', LOG_LEVEL: 'debug' });

    expect(config).toMatchObject({ host: '0.0.0.0', port: 8080, logLevel: 'debug' });
  });

  it('names a missing public URL, the fleet URL a starting prompt carries', () => {
    expect(() => loadConfig({ DATABASE_URL: databaseUrl })).toThrow(/PUBLIC_URL/);
  });

  it.each(['fleet.example.com', 'ftp://fleet.example.com'])(
    'rejects %j as the public URL: it is http or https',
    (url) => {
      expect(() => loadConfig({ ...required, PUBLIC_URL: url })).toThrow(/PUBLIC_URL/);
    },
  );

  it('takes an http public URL, as on a development machine', () => {
    expect(loadConfig({ ...required, PUBLIC_URL: 'http://127.0.0.1:4000' }).publicUrl).toBe('http://127.0.0.1:4000');
  });

  it('names a missing database URL', () => {
    expect(() => loadConfig({})).toThrow(ConfigError);
    expect(() => loadConfig({})).toThrow(/DATABASE_URL/);
  });

  it('rejects a database URL that is not Postgres', () => {
    expect(() => loadConfig({ DATABASE_URL: 'mysql://aeolus:s3cret@localhost/aeolus' })).toThrow(/DATABASE_URL/);
  });

  it('names every invalid variable at once', () => {
    expect(() => loadConfig({ PORT: 'eighty', LOG_LEVEL: 'loud' })).toThrow(
      /DATABASE_URL[\s\S]*PUBLIC_URL[\s\S]*PORT[\s\S]*LOG_LEVEL/,
    );
  });

  it('never echoes a value, so a password cannot leak', () => {
    const message = errorMessageOf(() =>
      loadConfig({ DATABASE_URL: 'mysql://aeolus:s3cret@localhost/aeolus', PUBLIC_URL: publicUrl }),
    );

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
