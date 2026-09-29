import { webHealth } from '../../lib/health';

// Answer every request fresh: never from a build-time or cached copy.
export const dynamic = 'force-dynamic';

const serverUrl = process.env.AEOLUS_SERVER_URL ?? 'http://127.0.0.1:4000';

/** Web up and the server's health. Nothing about fleets. */
export async function GET(): Promise<Response> {
  const { ok, body } = await webHealth(() =>
    fetch(`${serverUrl}/health`, { cache: 'no-store', signal: AbortSignal.timeout(3_000) }),
  );
  return Response.json(body, { status: ok ? 200 : 503 });
}
