import { webVersion } from '../../lib/version';

// Answer every request fresh: never from a build-time or cached copy.
export const dynamic = 'force-dynamic';

/** The versions this web process and the server process run; to a signed-in operator every running component's, plugins included, and the latest migration. */
export async function GET(request: Request): Promise<Response> {
  return Response.json(await webVersion(process.env, { cookie: request.headers.get('cookie') ?? undefined }));
}
