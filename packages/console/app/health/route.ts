import { webHealth } from '../../lib/health';

// Answer every request fresh: never from a build-time or cached copy.
export const dynamic = 'force-dynamic';

/** Web up and the server's health. Nothing about plugins or fleets. */
export async function GET(): Promise<Response> {
  const { isHealthy, body } = await webHealth(process.env);
  return Response.json(body, { status: isHealthy ? 200 : 503 });
}
