import { webHealth } from '../../lib/health';
import { serverUrlFrom } from '../../lib/server-url';
import { squadronsUrlFrom } from '../../lib/squadrons-url';

// Answer every request fresh: never from a build-time or cached copy.
export const dynamic = 'force-dynamic';

const TIMEOUT_MS = 3_000;

/** Web up, the server's health and, when the console has squadrons, squadrons' health. Nothing about fleets. */
export async function GET(): Promise<Response> {
  const squadronsUrl = squadronsUrlFrom(process.env);
  const { isHealthy, body } = await webHealth(
    () => fetch(`${serverUrlFrom(process.env)}/health`, { cache: 'no-store', signal: AbortSignal.timeout(TIMEOUT_MS) }),
    squadronsUrl === undefined ? undefined : () => fetch(`${squadronsUrl}/api/health`, { cache: 'no-store', signal: AbortSignal.timeout(TIMEOUT_MS) }),
  );
  return Response.json(body, { status: isHealthy ? 200 : 503 });
}
