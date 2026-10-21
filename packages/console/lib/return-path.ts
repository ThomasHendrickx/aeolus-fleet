/**
 * The console page a sign-in returns to. A browser resolves the path: it
 * drops tabs and newlines, reads a backslash as a slash and removes dot
 * segments, so `/a/..//evil.example` ends as `//evil.example`, another site.
 * The path is kept only when, so resolved, it is a page of the console's own
 * and resolving it again keeps it there, as the gateway's way back does.
 */

/** An origin no address is at: a path resolved against it that keeps it is the console's own, wherever the console is. */
const OWN_ORIGIN = 'https://console.invalid';

/** The path resolved as a browser resolves it, if it stays at the console's own origin. */
function resolvedOf(path: string): string | undefined {
  if (!URL.canParse(path, OWN_ORIGIN)) {
    return undefined;
  }
  const page = new URL(path, OWN_ORIGIN);
  return page.origin === OWN_ORIGIN ? `${page.pathname}${page.search}${page.hash}` : undefined;
}

/** Whether a path begins as a browser reads another site: two slashes, or a slash and a backslash. */
function isAnotherSite(path: string): boolean {
  return path.startsWith('//') || path.startsWith('/\\');
}

/** A page of the console to go back to, never a sign-in page, which would loop; the overview for anything else. */
export function returnPathOf(value: string | null): string {
  if (!value?.startsWith('/')) {
    return '/';
  }
  const resolved = resolvedOf(value);
  if (resolved === undefined || isAnotherSite(resolved) || resolved.startsWith('/sign-in') || resolvedOf(resolved) !== resolved) {
    return '/';
  }
  return resolved;
}
