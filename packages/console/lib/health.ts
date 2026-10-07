import { z } from 'zod';

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

/** Where the console's plugins answer their health; a plugin the console does not have is left out. */
export interface PluginHealthSources {
  fetchSquadronsHealth?: () => Promise<Response>;
  fetchTrierarchPluginHealth?: () => Promise<Response>;
}

async function serverPart(fetchServerHealth: () => Promise<Response>): Promise<Pick<WebHealth, 'server' | 'database'>> {
  try {
    const response = await fetchServerHealth();
    const reported: unknown = await response.json();
    const isObject = typeof reported === 'object' && reported !== null;
    const server = isObject && 'server' in reported ? reported.server : undefined;
    const database = isObject && 'database' in reported ? reported.database : undefined;
    return { server: server === 'up' ? 'up' : 'down', database: database === 'up' || database === 'down' ? database : 'unknown' };
  } catch {
    return { server: 'down', database: 'unknown' };
  }
}

async function pluginPart(fetchPluginHealth: () => Promise<Response>): Promise<PluginHealth> {
  try {
    const response = await fetchPluginHealth();
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
export async function webHealth(fetchServerHealth: () => Promise<Response>, plugins: PluginHealthSources = {}): Promise<{ isHealthy: boolean; body: WebHealth }> {
  const { fetchSquadronsHealth, fetchTrierarchPluginHealth } = plugins;
  const [fleet, squadrons, trierarchPlugin] = await Promise.all([
    serverPart(fetchServerHealth),
    fetchSquadronsHealth ? pluginPart(fetchSquadronsHealth) : undefined,
    fetchTrierarchPluginHealth ? pluginPart(fetchTrierarchPluginHealth) : undefined,
  ]);
  const body: WebHealth = {
    web: 'up',
    ...fleet,
    ...(squadrons === undefined ? {} : { squadrons }),
    ...(trierarchPlugin === undefined ? {} : { trierarchPlugin }),
  };
  return { isHealthy: body.server === 'up' && body.database === 'up', body };
}
