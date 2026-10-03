import { randomUUID } from 'node:crypto';

import { ConnectSquadronsError, connectSquadrons } from '../../../lib/connect-squadrons';
import { readSquadronsConnection, squadronsCalls } from '../../../lib/squadrons-calls';
import { serverInternalUrlFrom } from '../../../lib/server-url';
import { squadronsUrlFrom } from '../../../lib/squadrons-url';

// Answer every request fresh: the connection changes.
export const dynamic = 'force-dynamic';

/** Squadrons' connection for the console's Settings: `{ configured: false }` when the console has no squadrons. */
export async function GET(request: Request): Promise<Response> {
  const squadronsUrl = squadronsUrlFrom(process.env);
  if (squadronsUrl === undefined) {
    return Response.json({ configured: false });
  }
  try {
    const connection = await readSquadronsConnection(squadronsUrl, request.headers.get('cookie') ?? '');
    return Response.json({ configured: true, connection });
  } catch (error) {
    return Response.json({ message: messageOf(error) }, { status: 502 });
  }
}

/**
 * Connect squadrons, the operator's one button: commissions the management
 * ship or gives it a new starting prompt, and hands its secret to squadrons,
 * server to server. The browser gets the connection only. The request's Origin
 * goes along to the fleet, which takes the session's state-changing calls only
 * from the console.
 */
export async function POST(request: Request): Promise<Response> {
  const squadronsUrl = squadronsUrlFrom(process.env);
  const origin = request.headers.get('origin');
  if (squadronsUrl === undefined) {
    return Response.json({ message: 'This console has no squadrons' }, { status: 404 });
  }
  if (origin === null) {
    return Response.json({ message: 'Connect from the console' }, { status: 403 });
  }
  const calls = squadronsCalls({ serverUrl: serverInternalUrlFrom(process.env), squadronsUrl }, { cookie: request.headers.get('cookie') ?? '', origin });
  try {
    return Response.json({ configured: true, connection: await connectSquadrons(calls, randomUUID) });
  } catch (error) {
    return Response.json({ message: messageOf(error) }, { status: error instanceof ConnectSquadronsError ? 409 : 502 });
  }
}

/** A refusal's words are safe to show; anything else says only that squadrons or the fleet did not answer. */
function messageOf(error: unknown): string {
  return error instanceof ConnectSquadronsError ? error.message : 'squadrons or the fleet did not answer: try again in a moment';
}
