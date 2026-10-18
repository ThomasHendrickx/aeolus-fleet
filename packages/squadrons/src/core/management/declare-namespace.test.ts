import type { ShipId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { FLEET_ID, OTHER_FLEET_ID, SHIP_ID, memoryManagementStore } from '../../../test/support/management-fakes.js';
import { err, ok } from '../shared/result.js';
import { createDeclareNamespace, type DeclareNamespace } from './declare-namespace.js';
import type { DeclaredNamespace, ScopeDoor } from './ports.js';

const AT = new Date('2026-10-18T12:00:00.000Z');
const CREW_TOKEN = 'aeolus_ct_v1_squadrons';
const OTHER_PLUGIN: ShipId = 'shp_01m3tbfspe96yf1rnr4ank9x99';

let namespaces: DeclaredNamespace[];
let declared: { namespace: string; scopes: { scope: string; description: string }[] }[];
let isFleetAnswering: boolean;
let notices: { headline: string; key: string }[];
let declareNamespace: DeclareNamespace;

const door: ScopeDoor = {
  listScopes: () => Promise.resolve(isFleetAnswering ? ok(namespaces) : err({ code: 'UNAVAILABLE', message: 'The fleet did not answer' })),
  declareScopes: (_crewToken, declaration) => {
    declared.push(declaration);
    namespaces.push({ namespace: declaration.namespace, declaredBy: SHIP_ID });
    return Promise.resolve(ok(undefined));
  },
};

beforeEach(async () => {
  namespaces = [{ namespace: 'messages', declaredBy: null }];
  declared = [];
  isFleetAnswering = true;
  notices = [];
  const management = memoryManagementStore();
  await management.save({ fleetId: FLEET_ID, shipId: SHIP_ID, name: 'squadrons', crewToken: CREW_TOKEN, crewedAt: AT });
  declareNamespace = createDeclareNamespace({
    door,
    management,
    operator: {
      tell: (notice) => {
        notices.push({ headline: notice.headline, key: notice.key });
        return Promise.resolve();
      },
    },
  });
});

describe('squadrons declaring its namespace (decisions 0017 and 0046)', () => {
  it('declares squadrons with squadrons:form and squadrons:scale, each with a one-line description', async () => {
    await expect(declareNamespace(FLEET_ID)).resolves.toEqual({ isOk: true, value: { isDeclared: true } });

    expect(declared.map(({ namespace, scopes }) => ({ namespace, scopes: scopes.map((each) => each.scope) }))).toEqual([{ namespace: 'squadrons', scopes: ['squadrons:form', 'squadrons:scale'] }]);
    expect(declared[0]?.scopes.every((each) => each.description.length > 0 && !each.description.includes('\n'))).toBe(true);
  });

  it('declares nothing again once its own ship holds the namespace', async () => {
    await declareNamespace(FLEET_ID);

    await expect(declareNamespace(FLEET_ID)).resolves.toEqual({ isOk: true, value: { isDeclared: false } });
    expect(declared).toHaveLength(1);
  });

  it('declares nothing while another ship holds the namespace, and tells argo once', async () => {
    namespaces.push({ namespace: 'squadrons', declaredBy: OTHER_PLUGIN });

    await declareNamespace(FLEET_ID);
    await expect(declareNamespace(FLEET_ID)).resolves.toEqual({ isOk: true, value: { isDeclared: false } });

    expect(declared).toEqual([]);
    expect(notices).toEqual([
      { headline: 'squadrons cannot declare its namespace: another ship holds squadrons', key: 'namespace-taken' },
      { headline: 'squadrons cannot declare its namespace: another ship holds squadrons', key: 'namespace-taken' },
    ]);
  });

  it('is refused while the fleet does not answer, for the next rescan to try again', async () => {
    isFleetAnswering = false;

    await expect(declareNamespace(FLEET_ID)).resolves.toMatchObject({ isOk: false, error: { kind: 'FLEET_UNAVAILABLE' } });
  });

  it('is refused in a fleet squadrons is not connected to', async () => {
    await expect(declareNamespace(OTHER_FLEET_ID)).resolves.toMatchObject({ isOk: false, error: { kind: 'NOT_CONNECTED' } });
  });
});
