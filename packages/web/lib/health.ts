export type Status = 'up' | 'down';

export interface WebHealth {
  web: 'up';
  server: Status;
  database: Status | 'unknown';
}

/**
 * The web app is up (it is answering), plus what the server's /health says.
 * Nothing about fleets. `isHealthy` is false when anything behind the web app is down.
 */
export async function webHealth(
  fetchServerHealth: () => Promise<Response>,
): Promise<{ isHealthy: boolean; body: WebHealth }> {
  let body: WebHealth;
  try {
    const response = await fetchServerHealth();
    const reported: unknown = await response.json();
    const isObject = typeof reported === 'object' && reported !== null;
    const server = isObject && 'server' in reported ? reported.server : undefined;
    const database = isObject && 'database' in reported ? reported.database : undefined;
    body = {
      web: 'up',
      server: server === 'up' ? 'up' : 'down',
      database: database === 'up' || database === 'down' ? database : 'unknown',
    };
  } catch {
    body = { web: 'up', server: 'down', database: 'unknown' };
  }
  return { isHealthy: body.server === 'up' && body.database === 'up', body };
}
