/**
 * Where the server runs when AEOLUS_SERVER_URL is not set: beside the web app,
 * as in development. By `localhost`, like the console: one site, so the
 * session cookie goes along.
 */
const DEFAULT_SERVER_URL = 'http://localhost:4000';

/**
 * The Aeolus server's address, from AEOLUS_SERVER_URL, read when the web app
 * runs, never when it is built. The browser calls the server's `/trpc` there,
 * and the web app's `/health` asks the server's `/health`, so the address must
 * be reachable from both. No trailing slash.
 */
export function serverUrlFrom(environment: Readonly<Record<string, string | undefined>>): string {
  const configured = environment.AEOLUS_SERVER_URL;
  const url = configured === undefined || configured === '' ? DEFAULT_SERVER_URL : configured;
  return url.replace(/\/+$/, '');
}
