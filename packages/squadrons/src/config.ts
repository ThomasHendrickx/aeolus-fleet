import { homedir } from 'node:os';
import { join } from 'node:path';

import { z } from 'zod';

const environmentSchema = z.object({
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/, error: 'must be a postgres:// or postgresql:// URL' }),
  FLEET_URL: z.url({ protocol: /^https?$/, error: 'must be an http:// or https:// URL' }),
  HOST: z.string().min(1).default('127.0.0.1'),
  PORT: z.coerce.number().int().min(0).max(65_535).default(4100),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  SQUADRONS_CACHE_DIR: z.string().min(1).optional(),
  XDG_CACHE_HOME: z.string().min(1).optional(),
  HOME: z.string().min(1).optional(),
});

/** What `aeolus-squadrons migrate` reads: the database alone. */
const databaseEnvironmentSchema = environmentSchema.pick({ DATABASE_URL: true });

export interface Config {
  /** squadrons' own database (decision 0017), which may share the fleet's Postgres server. */
  databaseUrl: string;
  /**
   * The fleet's public URL, where squadrons calls the ship API as its
   * management ship and checks console sessions. Not a secret; fixed here, so
   * no caller can point squadrons at another fleet. The management ship's
   * secret is never configured: the operator connects squadrons in the console.
   */
  fleetUrl: string;
  host: string;
  port: number;
  logLevel: string;
  /** The folder squadrons keeps its own aeolus-squadrons folder of mirrors in: SQUADRONS_CACHE_DIR, or the user's cache folder. */
  cacheDir: string;
}

export class ConfigError extends Error {
  override name = 'ConfigError';
}

function parsed<T>(schema: z.ZodType<T>, environment: Record<string, string | undefined>): T {
  const result = schema.safeParse(environment);
  if (!result.success) {
    throw new ConfigError(result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('\n'));
  }
  return result.data;
}

/** The configuration from the environment; throws a ConfigError naming every variable that is wrong. */
export function loadConfig(environment: Record<string, string | undefined>): Config {
  const variables = parsed(environmentSchema, environment);
  return {
    databaseUrl: variables.DATABASE_URL,
    fleetUrl: variables.FLEET_URL.replace(/\/$/, ''),
    host: variables.HOST,
    port: variables.PORT,
    logLevel: variables.LOG_LEVEL,
    cacheDir: variables.SQUADRONS_CACHE_DIR ?? variables.XDG_CACHE_HOME ?? join(variables.HOME ?? homedir(), '.cache'),
  };
}

/** The database URL alone, for `aeolus-squadrons migrate`. */
export function loadDatabaseUrl(environment: Record<string, string | undefined>): string {
  return parsed(databaseEnvironmentSchema, environment).DATABASE_URL;
}
