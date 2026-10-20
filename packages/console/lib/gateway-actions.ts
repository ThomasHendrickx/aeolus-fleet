'use server';

import { headers } from 'next/headers';

import { connectPlugin, GATEWAY_SHIP } from './connect-plugin';
import { NOT_HERE, refusalOf, sessionCookie } from './gateway-reads';
import { gatewayUrlFrom } from './gateway-url';
import type { PluginAnswer } from './plugin-answer';
import { pluginCalls } from './plugin-calls';
import { serverInternalUrlFrom } from './server-url';
import { shownConnectionOf, type ShownConnection } from './shown-connection';

/**
 * Connect the gateway, the operator's one button: commissions its ship,
 * gateway with GATEWAY_SHIP's scopes, or gives it a new starting prompt,
 * and hands its secret to the gateway, server to server, as its read does
 * (lib/gateway-reads.ts). When the gateway refuses, its words show. The
 * browser gets the connection only.
 */
export async function connectGateway(): Promise<PluginAnswer<ShownConnection>> {
  const url = gatewayUrlFrom(process.env);
  const origin = (await headers()).get('origin');
  if (url === undefined) {
    return NOT_HERE;
  }
  if (origin === null) {
    return { kind: 'refused', message: 'Connect from the console' };
  }
  const calls = pluginCalls({ serverUrl: serverInternalUrlFrom(process.env), pluginUrl: url }, { cookie: await sessionCookie(), origin });
  try {
    return { kind: 'answered', data: shownConnectionOf(await connectPlugin(calls, { ship: GATEWAY_SHIP, newKey: () => crypto.randomUUID() })) };
  } catch (error) {
    return refusalOf(error);
  }
}
