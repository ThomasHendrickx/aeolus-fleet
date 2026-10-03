/**
 * Where the server runs when AEOLUS_SERVER_URL is not set: beside the web app,
 * as in development. By `localhost`, like the console: one site, so the
 * session cookie goes along.
 */
const DEFAULT_SERVER_URL = 'http://localhost:4000';

/**
 * The Aeolus server's address, from AEOLUS_SERVER_URL, read when the web app
 * runs, never when it is built. The browser calls the server's `/trpc` there;
 * the web app's server uses it too unless AEOLUS_SERVER_INTERNAL_URL is set.
 * No trailing slash.
 */
export function serverUrlFrom(environment: Readonly<Record<string, string | undefined>>): string {
  const configured = environment.AEOLUS_SERVER_URL;
  const url = configured === undefined || configured === '' ? DEFAULT_SERVER_URL : configured;
  return url.replace(/\/+$/, '');
}

/**
 * Where the web app's server reaches the server, from
 * AEOLUS_SERVER_INTERNAL_URL (for example `http://server:4000` inside
 * Compose), falling back to AEOLUS_SERVER_URL. Server side only: the browser
 * always uses AEOLUS_SERVER_URL. It keeps the web app's own calls off the
 * public address, which may route back to the web app. No trailing slash.
 */
export function serverInternalUrlFrom(environment: Readonly<Record<string, string | undefined>>): string {
  const internal = environment.AEOLUS_SERVER_INTERNAL_URL;
  return internal === undefined || internal === '' ? serverUrlFrom(environment) : internal.replace(/\/+$/, '');
}
