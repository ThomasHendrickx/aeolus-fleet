import { z } from 'zod';

const environmentSchema = z.object({
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/, error: 'must be a postgres:// or postgresql:// URL' }),
  HOST: z.string().min(1).default('127.0.0.1'),
  PORT: z.coerce.number().int().min(0).max(65_535).default(4000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  TRUST_PROXY: z.enum(['true', 'false'], { error: 'must be true or false' }).default('false'),
});

export interface Config {
  databaseUrl: string;
  host: string;
  port: number;
  logLevel: string;
  /** True behind a reverse proxy: the client address comes from X-Forwarded-For. */
  shouldTrustProxy: boolean;
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

  const { DATABASE_URL, HOST, PORT, LOG_LEVEL, TRUST_PROXY } = result.data;
  return {
    databaseUrl: DATABASE_URL,
    host: HOST,
    port: PORT,
    logLevel: LOG_LEVEL,
    shouldTrustProxy: TRUST_PROXY === 'true',
  };
}
