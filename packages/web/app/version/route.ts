import { serverInternalUrlFrom } from '../../lib/server-url';
import { squadronsUrlFrom } from '../../lib/squadrons-url';
import { webVersion } from '../../lib/version';

// Answer every request fresh: never from a build-time or cached copy.
export const dynamic = 'force-dynamic';

const TIMEOUT_MS = 3_000;

/** The versions this web process, the server process and, when the console has squadrons, squadrons run, with their latest migrations. Nothing about fleets. */
export async function GET(): Promise<Response> {
  const squadronsUrl = squadronsUrlFrom(process.env);
  const body = await webVersion({
    fetchServerVersion: () => fetch(`${serverInternalUrlFrom(process.env)}/api/version`, { cache: 'no-store', signal: AbortSignal.timeout(TIMEOUT_MS) }),
    fetchSquadronsVersion:
      squadronsUrl === undefined ? undefined : () => fetch(`${squadronsUrl}/api/version`, { cache: 'no-store', signal: AbortSignal.timeout(TIMEOUT_MS) }),
  });
  return Response.json(body);
}
