import { randomUUID } from 'node:crypto';

import { ConnectPluginError, connectPlugin, TRIERARCH_PLUGIN_SHIP } from '../../../lib/connect-plugin';
import { pluginCalls, readPluginConnection } from '../../../lib/plugin-calls';
import { serverInternalUrlFrom } from '../../../lib/server-url';
import { trierarchPluginUrlFrom } from '../../../lib/trierarch-plugin-url';

// Answer every request fresh: the connection changes.
export const dynamic = 'force-dynamic';

/** The trierarch plugin's connection for the console's Settings: `{ configured: false }` when the console has no trierarch plugin. */
export async function GET(request: Request): Promise<Response> {
  const pluginUrl = trierarchPluginUrlFrom(process.env);
  if (pluginUrl === undefined) {
    return Response.json({ configured: false });
  }
  try {
    const connection = await readPluginConnection(pluginUrl, request.headers.get('cookie') ?? '');
    return Response.json({ configured: true, connection });
  } catch (error) {
    return Response.json({ message: messageOf(error) }, { status: 502 });
  }
}

/**
 * Connect the trierarch plugin, the operator's one button (decision 0030):
 * commissions its ship, trierarch-plugin with fleet:read, fleet:manage,
 * crew:assign, labels:define and labels:assign, or gives it a new starting prompt, and hands its secret to the
 * trierarch plugin, server to server. The browser gets the connection only.
 * The request's Origin goes along to the fleet, which takes the session's
 * state-changing calls only from the console.
 */
export async function POST(request: Request): Promise<Response> {
  const pluginUrl = trierarchPluginUrlFrom(process.env);
  const origin = request.headers.get('origin');
  if (pluginUrl === undefined) {
    return Response.json({ message: 'This console has no trierarch plugin' }, { status: 404 });
  }
  if (origin === null) {
    return Response.json({ message: 'Connect from the console' }, { status: 403 });
  }
  const calls = pluginCalls({ serverUrl: serverInternalUrlFrom(process.env), pluginUrl }, { cookie: request.headers.get('cookie') ?? '', origin });
  try {
    return Response.json({ configured: true, connection: await connectPlugin(calls, { ship: TRIERARCH_PLUGIN_SHIP, newKey: randomUUID }) });
  } catch (error) {
    return Response.json({ message: messageOf(error) }, { status: error instanceof ConnectPluginError ? 409 : 502 });
  }
}

/** A refusal's words are safe to show; anything else says only that the trierarch plugin or the fleet did not answer. */
function messageOf(error: unknown): string {
  return error instanceof ConnectPluginError ? error.message : 'the trierarch plugin or the fleet did not answer: try again in a moment';
}
