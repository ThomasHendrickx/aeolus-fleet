import type { FleetId } from '@aeolus-fleet/common';
import { describe, expect, it } from 'vitest';

import { err, ok } from '../shared/result.js';
import { createAuthenticateOperator } from './authenticate-operator.js';
import type { ConsoleSessions } from './ports.js';

const FLEET: FleetId = 'flt_01m3tb1zgr5h2ffee12xnch8sv';
const OTHER_FLEET: FleetId = 'flt_01m3tb1zgr5h2ffee12xnch8sw';

const sessions: ConsoleSessions = {
  check: (cookie) =>
    Promise.resolve(
      cookie === 'aeolus_session=ours'
        ? ok({ fleetId: FLEET })
        : cookie === 'aeolus_session=theirs'
          ? ok({ fleetId: OTHER_FLEET })
          : err({ code: 'UNAUTHORIZED', message: 'No signed-in console session' }),
    ),
};

describe('the operator', () => {
  it.each([
    { label: 'our fleet', cookie: 'aeolus_session=ours', fleetId: FLEET },
    { label: 'another fleet on the same server', cookie: 'aeolus_session=theirs', fleetId: OTHER_FLEET },
  ])('is the signed-in console session of $label: squadrons serves every fleet at its FLEET_URL, each as its own', async ({ cookie, fleetId }) => {
    const authenticate = createAuthenticateOperator({ sessions });

    await expect(authenticate(cookie)).resolves.toEqual({ isOk: true, value: { fleetId } });
  });

  it.each([
    ['no cookie', undefined],
    ['a cookie of no signed-in session', 'aeolus_session=stale'],
  ])('is refused for %s', async (_label, cookie) => {
    const authenticate = createAuthenticateOperator({ sessions });

    await expect(authenticate(cookie)).resolves.toMatchObject({ isOk: false, error: { kind: 'NOT_THE_OPERATOR' } });
  });
});
