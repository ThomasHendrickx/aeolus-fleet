import type { ShipId } from '@aeolus-fleet/common';
import { z } from 'zod';

import { FLEET_URL, OPERATOR } from '../../../core/test/support/core-fixtures.js';

/** Signs the operator in to the fleet's console: the session cookie the web app's server forwards. */
export async function signIn(fleetUrl: string): Promise<string> {
  const response = await fetch(`${fleetUrl}/trpc/console.signIn`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: new URL(FLEET_URL).origin },
    body: JSON.stringify({ email: OPERATOR.email, password: OPERATOR.password }),
  });
  const set = response.headers.getSetCookie().find((each) => each.startsWith('aeolus_session='));
  return z.string().parse(set).split(';')[0] ?? '';
}

/** Calls squadrons' `connection.connect` with the operator's cookie, as the web app's server does. */
export async function connectSquadrons(address: string, request: { cookie: string; shipId: ShipId; secret: string }): Promise<Response> {
  return fetch(`${address}/trpc/connection.connect`, {
    method: 'POST',
    headers: { cookie: request.cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ shipId: request.shipId, secret: request.secret }),
  });
}
