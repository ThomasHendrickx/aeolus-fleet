import { z } from 'zod';

export type Status = 'up' | 'down';

/**
 * Squadrons' health: up, with how many fleets it holds a crew token for and
 * whether its installation token is set ('enabled') or not ('open'); or down
 * when it does not answer or its database is unreachable.
 */
export type SquadronsHealth = { status: 'up'; connectedFleets: number; installation: 'enabled' | 'open' } | { status: 'down' };

const squadronsHealthSchema = z.object({ connectedFleets: z.int().min(0), installation: z.enum(['enabled', 'open']) });

export interface WebHealth {
  web: 'up';
  server: Status;
  database: Status | 'unknown';
  /** Only when the console has squadrons. */
  squadrons?: SquadronsHealth;
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

async function squadronsPart(fetchSquadronsHealth: () => Promise<Response>): Promise<SquadronsHealth> {
  try {
    const response = await fetchSquadronsHealth();
    const reported = squadronsHealthSchema.safeParse(await response.json());
    return response.ok && reported.success ? { status: 'up', ...reported.data } : { status: 'down' };
  } catch {
    return { status: 'down' };
  }
}

/**
 * The web app is up (it is answering), plus what the server's /health says
 * and, when the console has squadrons, what squadrons' /api/health says.
 * Nothing about fleets. `isHealthy` is false when the server or its database
 * is down; squadrons down shows as its own part and leaves the fleet healthy.
 */
export async function webHealth(
  fetchServerHealth: () => Promise<Response>,
  fetchSquadronsHealth?: () => Promise<Response>,
): Promise<{ isHealthy: boolean; body: WebHealth }> {
  const [fleet, squadrons] = await Promise.all([serverPart(fetchServerHealth), fetchSquadronsHealth ? squadronsPart(fetchSquadronsHealth) : undefined]);
  const body: WebHealth = squadrons === undefined ? { web: 'up', ...fleet } : { web: 'up', ...fleet, squadrons };
  return { isHealthy: body.server === 'up' && body.database === 'up', body };
}
