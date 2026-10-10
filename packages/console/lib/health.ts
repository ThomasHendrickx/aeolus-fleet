import { serverInternalUrlFrom } from './server-url';

const TIMEOUT_MS = 3_000;

export type Status = 'up' | 'down';

export interface WebHealth {
  web: 'up';
  server: Status;
  database: Status | 'unknown';
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

/**
 * The web app is up (it is answering), plus what the server's /health says.
 * Asked without a session, so nothing about fleets and nothing about plugins
 * (#454): not which the console has, nor how they are configured; each plugin
 * answers its own /api/health. `isHealthy` is false when the server or its
 * database is down.
 */
export async function webHealth(environment: Readonly<Record<string, string | undefined>>): Promise<{ isHealthy: boolean; body: WebHealth }> {
  const body: WebHealth = { web: 'up', ...(await serverPart(serverInternalUrlFrom(environment))) };
  return { isHealthy: body.server === 'up' && body.database === 'up', body };
}
