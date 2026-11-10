import { accountIdSchema, SCOPES, type FleetId, type LabelValueId, type NetworkRule, type ScopeName, type ShipId } from '@aeolus-fleet/common';

import { prismaPoolOf } from '../../src/adapters/prisma/client.js';
import { createPrismaPersonReadUnitOfWork } from '../../src/adapters/prisma/person-read-unit-of-work.js';
import { createPrismaPersonShipReadTx } from '../../src/adapters/prisma/person-ship-reads.js';
import { createDiscoveryPage } from '../../src/domain/registry/discovery-page.js';
import { createReadShipReports } from '../../src/domain/registry/read-ship-reports.js';
import { createReadableContextShips } from '../../src/domain/registry/readable-context-ships.js';
import type { PersonReadUnitOfWork } from '../../src/domain/registry/person-read-unit-of-work.js';
import type { PersonShipReadTx } from '../../src/domain/registry/person-ship-reads.js';
import type { AccountCaller, Crew, ShipCaller } from '../../src/domain/shared/caller.js';
import { newKey } from '../../src/testing/keys.js';
import { unwrap } from '../../src/testing/result.js';
import { secretOf } from './core-fixtures.js';
import type { PostgresCore } from './postgres-core.js';

export function personReadsOf(uow: PersonReadUnitOfWork<PersonShipReadTx>) {
  return { discoveryPage: createDiscoveryPage({ uow }), shipReports: createReadShipReports({ uow }), readableContextShips: createReadableContextShips({ uow }) };
}

export function personReadUnitOfWork(core: PostgresCore): PersonReadUnitOfWork<PersonShipReadTx> {
  return createPrismaPersonReadUnitOfWork({ prisma: core.prisma, portsOf: (connection) => createPrismaPersonShipReadTx({ connection, onStatement: prismaPoolOf(core.prisma).onStatement }) });
}

export async function aPersonReadFleet(core: PostgresCore) {
  const key = newKey();
  const created = unwrap(await core.useCases.createFleet({ requestId: key, name: 'Person reads', operatorEmail: `${key}@example.test`, hasViewer: true }));
  const fleetId: FleetId = created.fleetId;
  const argo: ShipCaller = { kind: 'operator', shipId: created.operatorShipId, fleetId, scopes: SCOPES };
  const commission = async (input: { name: string; kind?: 'person'; scopes?: readonly ScopeName[]; note?: string }) => {
    return unwrap(await core.useCases.commissionShip(argo, { idempotencyKey: newKey(), name: input.name, type: input.kind ?? 'builder', kind: input.kind, scopes: input.scopes, note: input.note }));
  };
  const crew = async (input: { name: string; kind?: 'person'; scopes?: readonly ScopeName[]; note?: string }): Promise<{ shipId: ShipId; crew: Crew; crewToken: string }> => {
    const commissioned = await commission(input);
    const claimed = unwrap(await core.useCases.claimShip({ shipId: commissioned.shipId, secret: secretOf(commissioned.secret), location: { kind: 'DEVICE' }, harness: 'codex' }));
    return { shipId: commissioned.shipId, crewToken: claimed.crewToken, crew: unwrap(await core.useCases.authenticate.byCrewToken(claimed.crewToken)) };
  };
  const person = await crew({ name: 'person-one', kind: 'person' });
  const account = (change: Partial<AccountCaller> = {}): AccountCaller => ({ kind: 'account', fleetId, accountId: accountIdSchema.parse('person-read-account'), scopes: ['fleet:read'], groupValues: [], personShipId: person.shipId, throughShipId: null, ...change });
  const setRules = async (rules: readonly NetworkRule[] | null) => {
    const saved = unwrap(await core.useCases.saveNetworkRulesDraft(argo, { rules }));
    unwrap(await core.useCases.applyNetworkRules(argo, { version: saved.savedAgainstVersion }));
  };
  const label = async (name: string): Promise<LabelValueId> => {
    const defined = unwrap(await core.useCases.defineLabel(argo, { key: name, values: ['allowed'] }));
    const value = defined.values[0];
    if (value === undefined) {
      throw new Error('The fixture label has no value');
    }
    return value.id;
  };
  return { fleetId, argo, person, account, commission, crew, setRules, label, reads: personReadsOf(personReadUnitOfWork(core)) };
}
