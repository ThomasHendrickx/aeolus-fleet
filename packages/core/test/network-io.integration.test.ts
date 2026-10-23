import { SCOPES, createIdGenerator, type LabelValueId, type NetworkRulesFile } from '@aeolus-fleet/common';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createPrismaUnitOfWork } from '../src/adapters/prisma/unit-of-work.js';
import { createImportNetworkRules } from '../src/domain/registry/import-network-rules.js';
import type { ShipCaller } from '../src/domain/shared/caller.js';
import { newKey } from '../src/testing/keys.js';
import { unwrap } from '../src/testing/result.js';
import { operatorCaller } from './support/core-fixtures.js';
import { withOperatorLogin } from './support/operator-login.js';
import { createPostgresCore, everyRow, type PostgresCore } from './support/postgres-core.js';

// Export and import of the network rules on a real Postgres (design
// network-io): the labels a rule names found by label and value ids, the
// definers and owners by name; an import defining its labels and saving the
// draft in one transaction, which stores nothing when it fails; and two
// imports of one new key at once, taking turns on the key's lock, so the
// second finds the label the first defined and never defines it twice.

const newId = createIdGenerator();

let core: PostgresCore;
let argo: ShipCaller;
let networker: ShipCaller;
let labeller: ShipCaller;

async function aShip(name: string, scopes: ShipCaller['scopes'] = []): Promise<ShipCaller> {
  const { shipId } = unwrap(await core.useCases.commissionShip(argo, { idempotencyKey: newKey(), name, type: name, scopes }));
  return { fleetId: argo.fleetId, shipId, kind: 'agent', scopes: ['messages:send', 'messages:receive', ...scopes] };
}

/** A second fleet of the installation, with no rules and no labels: argo, holding every scope. */
async function aNewFleet(): Promise<ShipCaller> {
  const created = unwrap(await core.useCases.createFleet({ requestId: newKey(), name: 'production', operatorEmail: 'production@example.com' }));
  return { fleetId: created.fleetId, shipId: created.operatorShipId, kind: 'operator', scopes: [...SCOPES] };
}

beforeEach(async () => {
  core = await createPostgresCore();
  argo = operatorCaller(unwrap(await withOperatorLogin(core.prisma, core.useCases.initialiseFleet({ name: 'staging' }))));
  networker = await aShip('networker', ['fleet:network', 'labels:define']);
  labeller = await aShip('crm-app', ['labels:define']);
  const crm = unwrap(await core.useCases.defineLabel(labeller, { key: 'crm', values: ['app', 'user'] }));
  unwrap(await core.useCases.defineLabel(labeller, { key: 'os', values: ['linux'] }));
  const [app, user]: LabelValueId[] = crm.values.map((value) => value.id);
  const { savedAgainstVersion } = unwrap(
    await core.useCases.saveNetworkRulesDraft(networker, {
      rules: [
        { verb: 'send', from: [user ?? newId('labelValue')], to: [app ?? newId('labelValue')] },
        { verb: 'read', from: [{ owner: labeller.shipId }], to: [{ labelId: crm.labelId, value: '*' }] },
      ],
    }),
  );
  unwrap(await core.useCases.applyNetworkRules(networker, { version: savedAgainstVersion }));
});

afterEach(async () => {
  await core.close();
});

describe('exporting the network rules', () => {
  it('names the labels the rules use, by value and by label, their definers and the owners, from the store', async () => {
    const file = unwrap(await core.useCases.exportNetworkRules(networker));

    expect({ labels: file.labels, rules: file.rules, rulesVersion: file.rulesVersion }).toEqual({
      labels: [{ key: 'crm', values: ['app', 'user'], definer: 'crm-app' }],
      rules: [
        { verb: 'send', from: [{ label: 'crm', value: 'user' }], to: [{ label: 'crm', value: 'app' }] },
        { verb: 'read', from: [{ owner: 'crm-app' }], to: [{ label: 'crm', value: '*' }] },
      ],
      rulesVersion: 1,
    });
  });
});

describe('importing the network rules', () => {
  let file: NetworkRulesFile;

  beforeEach(async () => {
    file = unwrap(await core.useCases.exportNetworkRules(networker));
  });

  it('brings a new fleet the rules before its ships, defining the labels for argo and saving the draft', async () => {
    const production = await aNewFleet();
    const crmApp = unwrap(await core.useCases.commissionShip(production, { idempotencyKey: newKey(), name: 'crm-app', type: 'crm' }));
    const importer = production;
    const checked = unwrap(await core.useCases.checkNetworkRulesFile(importer, { file: JSON.stringify(file) }));

    expect(checked).toMatchObject({ newLabels: ['crm'], differences: [] });
    expect(unwrap(await core.useCases.importNetworkRules(importer, { file: JSON.stringify(file), resolutions: [] }))).toEqual({ savedAgainstVersion: 0, definedLabels: ['crm'] });
    const labels = await core.prisma.label.findMany({ where: { fleetId: production.fleetId }, include: { values: { orderBy: { position: 'asc' } } } });
    expect(labels.map((label) => ({ key: label.key, owner: label.ownerShipId, values: label.values.map((value) => value.value) }))).toEqual([
      { key: 'crm', owner: production.shipId, values: ['app', 'user'] },
    ]);
    const draft = await core.prisma.networkRulesDraft.findUnique({ where: { fleetId: production.fleetId } });
    const [userId, appId] = [labels[0]?.values[1]?.id, labels[0]?.values[0]?.id];
    expect(draft?.rules).toEqual([
      { verb: 'send', from: [userId], to: [appId] },
      { verb: 'read', from: [{ owner: crmApp.shipId }], to: [{ labelId: labels[0]?.id, value: '*' }] },
    ]);
  });

  it('stores nothing when NetworkRulesDraftSaved cannot be written, not even the labels it defined', async () => {
    const production = await aNewFleet();
    unwrap(await core.useCases.commissionShip(production, { idempotencyKey: newKey(), name: 'crm-app', type: 'crm' }));
    const before = await everyRow(core.prisma);
    const failingImport = createImportNetworkRules({
      uow: {
        run: (work) =>
          createPrismaUnitOfWork(core.prisma).run((tx) =>
            work({ ...tx, events: { append: (event) => (event.type === 'NetworkRulesDraftSaved' ? Promise.reject(new Error('disk full')) : tx.events.append(event)) } }),
          ),
      },
      clock: core.clock,
      ids: newId,
    });

    await expect(failingImport(production, { file: JSON.stringify(file), resolutions: [] })).rejects.toThrow('disk full');

    await expect(everyRow(core.prisma)).resolves.toBe(before);
  });

  it('lets two imports of one new key take turns: the second finds the label the first defined, for argo, and refuses it as a difference', async () => {
    const production = await aNewFleet();
    unwrap(await core.useCases.commissionShip(production, { idempotencyKey: newKey(), name: 'crm-app', type: 'crm' }));
    const importer = production;
    const both = await Promise.all([
      core.useCases.importNetworkRules(importer, { file: JSON.stringify(file), resolutions: [] }),
      core.useCases.importNetworkRules(importer, { file: JSON.stringify(file), resolutions: [] }),
    ]);

    expect(both.map((imported) => (imported.isOk ? imported.value.definedLabels : imported.error.kind)).sort()).toEqual(['LABEL_DIFFERENCES', ['crm']]);
    expect(await core.prisma.label.count({ where: { fleetId: production.fleetId } })).toBe(1);
  });
});
