import { webHealth } from '../../lib/health';
import { serverInternalUrlFrom } from '../../lib/server-url';
import { squadronsUrlFrom } from '../../lib/squadrons-url';
import { trierarchPluginUrlFrom } from '../../lib/trierarch-plugin-url';

// Answer every request fresh: never from a build-time or cached copy.
export const dynamic = 'force-dynamic';

const TIMEOUT_MS = 3_000;

/** Web up, the server's health and the health of each plugin the console has: squadrons, the trierarch plugin. Nothing about fleets. */
export async function GET(): Promise<Response> {
  const squadronsUrl = squadronsUrlFrom(process.env);
  const trierarchPluginUrl = trierarchPluginUrlFrom(process.env);
  const healthOf = (url: string) => () => fetch(`${url}/api/health`, { cache: 'no-store', signal: AbortSignal.timeout(TIMEOUT_MS) });
  const { isHealthy, body } = await webHealth(() => fetch(`${serverInternalUrlFrom(process.env)}/health`, { cache: 'no-store', signal: AbortSignal.timeout(TIMEOUT_MS) }), {
    ...(squadronsUrl === undefined ? {} : { fetchSquadronsHealth: healthOf(squadronsUrl) }),
    ...(trierarchPluginUrl === undefined ? {} : { fetchTrierarchPluginHealth: healthOf(trierarchPluginUrl) }),
  });
  return Response.json(body, { status: isHealthy ? 200 : 503 });
}
