/**
 * Asks the fleet whether a forwarded console session cookie is a signed-in
 * operator's, with `console.session` (decision 0012): the cookie travels from
 * the web app's server, server to server.
 */
import { idSchema } from '@aeolus-fleet/common';
import { z } from 'zod';

import type { ConsoleSessions } from '../../core/operator/ports.js';
import { err, ok } from '../../core/shared/result.js';

const sessionAnswer = z.object({ result: z.object({ data: z.object({ fleetId: idSchema('fleet') }) }) });

export function createFleetConsoleSessions(fleetUrl: string): ConsoleSessions {
  return {
    check: async (cookie) => {
      const response = await fetch(`${fleetUrl}/trpc/console.session`, { headers: { cookie } });
      if (!response.ok) {
        return err({ code: 'UNAUTHORIZED', message: 'No signed-in console session' });
      }
      return ok({ fleetId: sessionAnswer.parse(await response.json()).result.data.fleetId });
    },
  };
}
