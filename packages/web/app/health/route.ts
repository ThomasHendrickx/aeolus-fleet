import { webHealth } from '../../lib/health';
import { serverUrlFrom } from '../../lib/server-url';

// Answer every request fresh: never from a build-time or cached copy.
export const dynamic = 'force-dynamic';

/** Web up and the server's health. Nothing about fleets. */
export async function GET(): Promise<Response> {
  const { isHealthy, body } = await webHealth(() =>
    fetch(`${serverUrlFrom(process.env)}/health`, { cache: 'no-store', signal: AbortSignal.timeout(3_000) }),
  );
  return Response.json(body, { status: isHealthy ? 200 : 503 });
}
