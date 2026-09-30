import { z } from 'zod';

/** A domain name alone, such as example.com: no scheme, port, path or leading dot. */
const DOMAIN_NAME = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/i;

/** An http or https origin: a URL with no user, path, query or fragment. A trailing slash is allowed. */
function isOrigin(value: string): boolean {
  const url = URL.parse(value);
  return (
    url !== null &&
    url.username === '' &&
    url.password === '' &&
    url.pathname === '/' &&
    url.search === '' &&
    url.hash === '' &&
    !value.endsWith('?') &&
    !value.endsWith('#')
  );
}

const environmentSchema = z.object({
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/, error: 'must be a postgres:// or postgresql:// URL' }),
  PUBLIC_URL: z.url({ protocol: /^https?$/, error: 'must be an http:// or https:// URL' }),
  HOST: z.string().min(1).default('127.0.0.1'),
  PORT: z.coerce.number().int().min(0).max(65_535).default(4000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  TRUST_PROXY: z.enum(['true', 'false'], { error: 'must be true or false' }).default('false'),
  COOKIE_DOMAIN: z.string().regex(DOMAIN_NAME, 'must be a domain name like example.com').optional(),
  CONSOLE_ORIGIN: z
    .url({ protocol: /^https?$/, error: 'must be an http:// or https:// origin' })
    .refine(isOrigin, 'must be an origin without a path, like https://console.example.com')
    .transform((origin) => new URL(origin).origin)
    .optional(),
});

export interface Config {
  databaseUrl: string;
  /** Where ships reach the fleet: the fleet URL every starting prompt carries. */
  publicUrl: string;
  host: string;
  port: number;
  logLevel: string;
  /** True behind a reverse proxy: the client address comes from X-Forwarded-For. */
  shouldTrustProxy: boolean;
  /** The domain the session cookie is set for, so every host under it receives it. Unset: the server's host only. */
  cookieDomain: string | undefined;
  /**
   * The console's origin: state-changing console calls come only from it, and
   * a console on another host may call from it with credentials (CORS).
   * Defaults to the public URL's origin: web and server behind one host.
   */
  consoleOrigin: string;
}

export class ConfigError extends Error {
  override name = 'ConfigError';
}

/**
 * Reads the server configuration from environment variables. Throws a
 * ConfigError naming every invalid variable. Values are never echoed, because
 * the database URL carries a password.
 */
export function loadConfig(environment: Record<string, string | undefined>): Config {
  const result = environmentSchema.safeParse(environment);
  if (!result.success) {
    const problems = result.error.issues.map((issue) => `  ${issue.path.join('.')}: ${issue.message}`);
    throw new ConfigError(`Invalid configuration:\n${problems.join('\n')}`);
  }

  const { DATABASE_URL, PUBLIC_URL, HOST, PORT, LOG_LEVEL, TRUST_PROXY, COOKIE_DOMAIN, CONSOLE_ORIGIN } = result.data;
  return {
    databaseUrl: DATABASE_URL,
    publicUrl: PUBLIC_URL,
    host: HOST,
    port: PORT,
    logLevel: LOG_LEVEL,
    shouldTrustProxy: TRUST_PROXY === 'true',
    cookieDomain: COOKIE_DOMAIN,
    consoleOrigin: CONSOLE_ORIGIN ?? new URL(PUBLIC_URL).origin,
  };
}
