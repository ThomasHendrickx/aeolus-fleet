import { serverInternalUrlFrom } from '../../lib/server-url';
import { squadronsUrlFrom } from '../../lib/squadrons-url';
import { trierarchPluginUrlFrom } from '../../lib/trierarch-plugin-url';
import { webVersion } from '../../lib/version';

// Answer every request fresh: never from a build-time or cached copy.
export const dynamic = 'force-dynamic';

const TIMEOUT_MS = 3_000;

/** The versions this web process, the server process and each plugin the console has (squadrons, the trierarch plugin) run, with their latest migrations. Nothing about fleets. */
export async function GET(): Promise<Response> {
  const squadronsUrl = squadronsUrlFrom(process.env);
  const trierarchPluginUrl = trierarchPluginUrlFrom(process.env);
  const versionOf = (url: string) => () => fetch(`${url}/api/version`, { cache: 'no-store', signal: AbortSignal.timeout(TIMEOUT_MS) });
  const body = await webVersion({
    fetchServerVersion: versionOf(serverInternalUrlFrom(process.env)),
    ...(squadronsUrl === undefined ? {} : { fetchSquadronsVersion: versionOf(squadronsUrl) }),
    ...(trierarchPluginUrl === undefined ? {} : { fetchTrierarchPluginVersion: versionOf(trierarchPluginUrl) }),
  });
  return Response.json(body);
}
