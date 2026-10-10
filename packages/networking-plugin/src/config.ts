import { z } from 'zod';

/** The shortest installation token the networking plugin takes, as the fleet core does (decision 0020). */
const INSTALLATION_TOKEN_MIN_LENGTH = 32;

/** How often a supply the fleet refused is tried again, by default. */
const DEFAULT_SUPPLY_RETRY_SECONDS = 10;

const MS_PER_SECOND = 1000;

const environmentSchema = z.object({
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/, error: 'must be a postgres:// or postgresql:// URL' }),
  FLEET_URL: z.url({ protocol: /^https?$/, error: 'must be an http:// or https:// URL' }),
  HOST: z.string().min(1).default('127.0.0.1'),
  PORT: z.coerce.number().int().min(0).max(65_535).default(4300),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  SUPPLY_RETRY_SECONDS: z.coerce.number().int().positive().default(DEFAULT_SUPPLY_RETRY_SECONDS),
  INSTALLATION_TOKEN: z.string().min(INSTALLATION_TOKEN_MIN_LENGTH, { error: `must hold at least ${String(INSTALLATION_TOKEN_MIN_LENGTH)} characters` }).optional(),
});

/** What `aeolus-networking-plugin migrate` reads: the database alone. */
const databaseEnvironmentSchema = environmentSchema.pick({ DATABASE_URL: true });

export interface Config {
  /** The networking plugin's own database (decision 0035), which may share the Postgres server with the fleet and squadrons. */
  databaseUrl: string;
  /**
   * The fleet's public URL, where the networking plugin calls the ship API as
   * its ship and checks console sessions. Not a secret; fixed here, so no
   * caller can point the networking plugin at another fleet. Its ship's secret is never configured: the
   * operator connects the networking plugin in the console.
   */
  fleetUrl: string;
  host: string;
  port: number;
  logLevel: string;
  /**
   * The token a hosting service presents to the installation procedures
   * (decision 0021). Unset, they are off and every fleet is served, as
   * a self-hosted networking plugin needs; set, a fleet is served once switched on.
   */
  installationToken: string | undefined;
  /** How often each fleet whose last supply the fleet refused is supplied again. */
  supplyRetryMs: number;
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
    installationToken: variables.INSTALLATION_TOKEN,
    supplyRetryMs: variables.SUPPLY_RETRY_SECONDS * MS_PER_SECOND,
  };
}

/** The database URL alone, for `aeolus-networking-plugin migrate`. */
export function loadDatabaseUrl(environment: Record<string, string | undefined>): string {
  return parsed(databaseEnvironmentSchema, environment).DATABASE_URL;
}
