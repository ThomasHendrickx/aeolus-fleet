import { serverUrlFrom } from '../../lib/server-url';
import { webVersion } from '../../lib/version';

// Answer every request fresh: never from a build-time or cached copy.
export const dynamic = 'force-dynamic';

/** The versions this web process and the server process run, and the latest migration. Nothing about fleets. */
export async function GET(): Promise<Response> {
  const body = await webVersion(() =>
    fetch(`${serverUrlFrom(process.env)}/api/version`, { cache: 'no-store', signal: AbortSignal.timeout(3_000) }),
  );
  return Response.json(body);
}
