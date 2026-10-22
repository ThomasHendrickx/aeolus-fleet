/**
 * The console's own public origin, from AEOLUS_CONSOLE_URL, read when the web
 * app runs. Behind a proxy the request's URL holds the address the web app's
 * server binds (such as `0.0.0.0:3000`), never the one the browser uses, so
 * every address the console gives out (pagasae's redirect, the origin it
 * shows core) and every origin it checks comes from here. A production start
 * needs it; development falls back to the request's origin.
 */

type Environment = Readonly<Record<string, string | undefined>>;

function configuredOriginOf(environment: Environment): string | undefined {
  const configured = environment.AEOLUS_CONSOLE_URL;
  if (configured === undefined || !URL.canParse(configured)) {
    return undefined;
  }
  const url = new URL(configured);
  return url.protocol === 'https:' || url.protocol === 'http:' ? url.origin : undefined;
}

/** The console's public origin: AEOLUS_CONSOLE_URL's, or in development the request's. */
export function consoleOriginOf(request: Request, environment: Environment): string {
  return configuredOriginOf(environment) ?? new URL(request.url).origin;
}

/** Why a production start stops: no AEOLUS_CONSOLE_URL, or not an http(s) URL. A silent fallback to the bind address is what broke sign-in behind a proxy. */
export function missingConsoleUrlOf(environment: Environment): string | undefined {
  if (environment.NODE_ENV !== 'production' || configuredOriginOf(environment) !== undefined) {
    return undefined;
  }
  return "AEOLUS_CONSOLE_URL must be the console's public address, such as https://fleet.example.com: behind a proxy the web app sees only the address it binds, and sign-in would send that to pagasae.";
}
