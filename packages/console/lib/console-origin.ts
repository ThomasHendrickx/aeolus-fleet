/**
 * The console's own public origin, from AEOLUS_CONSOLE_URL, read when the web
 * app runs. Behind a proxy the request's URL holds the address the web app's
 * server binds (such as `0.0.0.0:3000`), never the one the browser uses, so
 * every address the console gives out (pagasae's redirect, the origin it
 * shows core) and every origin it checks comes from here. Unset, or not an
 * http(s) URL, it is the request's origin, as in development.
 */
export function consoleOriginOf(request: Request, environment: Readonly<Record<string, string | undefined>>): string {
  const configured = environment.AEOLUS_CONSOLE_URL;
  if (configured !== undefined && URL.canParse(configured)) {
    const url = new URL(configured);
    if (url.protocol === 'https:' || url.protocol === 'http:') {
      return url.origin;
    }
  }
  return new URL(request.url).origin;
}
