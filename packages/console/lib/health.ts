import { z } from 'zod';

import { serverInternalUrlFrom } from './server-url';
import { squadronsUrlFrom } from './squadrons-url';
import { trierarchPluginUrlFrom } from './trierarch-plugin-url';

const TIMEOUT_MS = 3_000;

export type Status = 'up' | 'down';

/**
 * A plugin's health, squadrons' or the trierarch plugin's: up, with how many
 * fleets it holds a crew token for and whether its installation token is set
 * ('enabled') or not ('open'); or down when it does not answer or its
 * database is unreachable.
 */
export type PluginHealth = { status: 'up'; connectedFleets: number; installation: 'enabled' | 'open' } | { status: 'down' };

const pluginHealthSchema = z.object({ connectedFleets: z.int().min(0), installation: z.enum(['enabled', 'open']) });

export interface WebHealth {
  web: 'up';
  server: Status;
  database: Status | 'unknown';
  /** Only when the console has squadrons. */
  squadrons?: PluginHealth;
  /** Only when the console has the trierarch plugin. */
  trierarchPlugin?: PluginHealth;
}

async function serverPart(url: string): Promise<Pick<WebHealth, 'server' | 'database'>> {
  try {
    const response = await fetch(`${url}/health`, { cache: 'no-store', signal: AbortSignal.timeout(TIMEOUT_MS) });
    const reported: unknown = await response.json();
    const isObject = typeof reported === 'object' && reported !== null;
    const server = isObject && 'server' in reported ? reported.server : undefined;
    const database = isObject && 'database' in reported ? reported.database : undefined;
    return { server: server === 'up' ? 'up' : 'down', database: database === 'up' || database === 'down' ? database : 'unknown' };
  } catch {
    return { server: 'down', database: 'unknown' };
  }
}

async function pluginPart(url: string): Promise<PluginHealth> {
  try {
    const response = await fetch(`${url}/api/health`, { cache: 'no-store', signal: AbortSignal.timeout(TIMEOUT_MS) });
    const reported = pluginHealthSchema.safeParse(await response.json());
    return response.ok && reported.success ? { status: 'up', ...reported.data } : { status: 'down' };
  } catch {
    return { status: 'down' };
  }
}

/**
 * The web app is up (it is answering), plus what the server's /health says
 * and, for each plugin the console has, what its /api/health says. Nothing
 * about fleets. `isHealthy` is false when the server or its database is down;
 * a plugin down shows as its own part and leaves the fleet healthy.
 */
export async function webHealth(environment: Readonly<Record<string, string | undefined>>): Promise<{ isHealthy: boolean; body: WebHealth }> {
  const squadronsUrl = squadronsUrlFrom(environment);
  const trierarchPluginUrl = trierarchPluginUrlFrom(environment);
  const [fleet, squadrons, trierarchPlugin] = await Promise.all([
    serverPart(serverInternalUrlFrom(environment)),
    squadronsUrl === undefined ? undefined : pluginPart(squadronsUrl),
    trierarchPluginUrl === undefined ? undefined : pluginPart(trierarchPluginUrl),
  ]);
  const body: WebHealth = {
    web: 'up',
    ...fleet,
    ...(squadrons === undefined ? {} : { squadrons }),
    ...(trierarchPlugin === undefined ? {} : { trierarchPlugin }),
  };
  return { isHealthy: body.server === 'up' && body.database === 'up', body };
}
