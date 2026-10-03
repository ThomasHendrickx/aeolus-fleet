import { idSchema, type ShipId } from '@aeolus-fleet/common';
import { z } from 'zod';

const environmentSchema = z.object({
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/, error: 'must be a postgres:// or postgresql:// URL' }),
  FLEET_URL: z.url({ protocol: /^https?$/, error: 'must be an http:// or https:// URL' }),
  MANAGEMENT_SHIP_ID: idSchema('ship'),
  MANAGEMENT_SHIP_SECRET: z.string().min(1).optional(),
  HOST: z.string().min(1).default('127.0.0.1'),
  PORT: z.coerce.number().int().min(0).max(65_535).default(4100),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});

/** What `aeolus-squadrons migrate` reads: the database alone. */
const databaseEnvironmentSchema = environmentSchema.pick({ DATABASE_URL: true });

export interface Config {
  /** squadrons' own database (decision 0017), which may share the fleet's Postgres server. */
  databaseUrl: string;
  /** The fleet's public URL, where squadrons calls the ship API as its management ship. */
  fleetUrl: string;
  /** The ship with fleet:read and fleet:manage that squadrons crews; its secret only until squadrons holds a crew token. */
  managementShip: { shipId: ShipId; secret: string | undefined };
  host: string;
  port: number;
  logLevel: string;
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
    managementShip: { shipId: variables.MANAGEMENT_SHIP_ID, secret: variables.MANAGEMENT_SHIP_SECRET },
    host: variables.HOST,
    port: variables.PORT,
    logLevel: variables.LOG_LEVEL,
  };
}

/** The database URL alone, for `aeolus-squadrons migrate`. */
export function loadDatabaseUrl(environment: Record<string, string | undefined>): string {
  return parsed(databaseEnvironmentSchema, environment).DATABASE_URL;
}
