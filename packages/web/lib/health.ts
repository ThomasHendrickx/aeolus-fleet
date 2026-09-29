export type Status = 'up' | 'down';

export interface WebHealth {
  web: 'up';
  server: Status;
  database: Status | 'unknown';
}

/**
 * The web app is up (it is answering), plus what the server's /health says.
 * Nothing about fleets. `ok` is false when anything behind the web app is down.
 */
export async function webHealth(fetchServerHealth: () => Promise<Response>): Promise<{ ok: boolean; body: WebHealth }> {
  let body: WebHealth;
  try {
    const response = await fetchServerHealth();
    const server = (await response.json()) as { server?: unknown; database?: unknown };
    body = {
      web: 'up',
      server: server.server === 'up' ? 'up' : 'down',
      database: server.database === 'up' || server.database === 'down' ? server.database : 'unknown',
    };
  } catch {
    body = { web: 'up', server: 'down', database: 'unknown' };
  }
  return { ok: body.server === 'up' && body.database === 'up', body };
}
