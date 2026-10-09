import { webVersion } from '../../lib/version';

// Answer every request fresh: never from a build-time or cached copy.
export const dynamic = 'force-dynamic';

/** The versions this web process and the server process run. Nothing about plugins or fleets. */
export async function GET(): Promise<Response> {
  return Response.json(await webVersion(process.env));
}
