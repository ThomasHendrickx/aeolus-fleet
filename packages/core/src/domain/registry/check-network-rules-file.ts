import type { CheckedNetworkRulesFile, FleetId, NetworkRulesFile, ShipId } from '@aeolus-fleet/common';

import type { Caller } from '../shared/caller.js';
import { ok, type Result } from '../shared/result.js';
import type { UnitOfWork } from '../shared/unit-of-work.js';
import { definerNameOf } from './export-network-rules.js';
import type { Label } from './label.js';
import { differencesOf, ownerNamesIn, readNetworkRulesFile, type FleetLabel, type InvalidNetworkRulesFile } from './network-rules-file.js';
import type { LabelRepository, ShipRepository } from './ports.js';

export interface CheckNetworkRulesFileTx {
  labels: Pick<LabelRepository, 'findByKey'>;
  ships: Pick<ShipRepository, 'find' | 'findActiveByName'>;
}

export type CheckNetworkRulesFile = (caller: Caller, input: { file: string }) => Promise<Result<CheckedNetworkRulesFile, InvalidNetworkRulesFile>>;

/**
 * Use case: any actor holding fleet:network and labels:define checks a
 * network rules file before importing it (design network-io, section 5,
 * steps 2 and 3), the scopes checked before this runs: the file read, the
 * labels import would define, and every difference with the fleet, each with
 * the ways to resolve it. It changes nothing.
 */
export function createCheckNetworkRulesFile(deps: { uow: UnitOfWork<CheckNetworkRulesFileTx> }): CheckNetworkRulesFile {
  return (caller, input) =>
    deps.uow.run(async (tx): Promise<Result<CheckedNetworkRulesFile, InvalidNetworkRulesFile>> => {
      const read = readNetworkRulesFile(input.file);
      if (!read.isOk) {
        return read;
      }
      const file = read.value;
      const fleet = await fleetAsTheFileSeesIt(tx, { fleetId: caller.fleetId, file });
      return ok({ file, ...differencesOf(file, fleet) });
    });
}

/**
 * What of the fleet a file names: its labels with the file's keys, as they
 * are and as the file compares them, with their values and definers, and
 * the active ships with the file's owner ship names, by name.
 */
export async function fleetAsTheFileSeesIt(
  tx: CheckNetworkRulesFileTx,
  read: { fleetId: FleetId; file: NetworkRulesFile },
): Promise<{ labels: FleetLabel[]; found: Label[]; activeShipNames: string[]; ships: Map<string, ShipId> }> {
  const { fleetId, file } = read;
  const found: Label[] = [];
  for (const { key } of file.labels) {
    const label = await tx.labels.findByKey(fleetId, key);
    if (label) {
      found.push(label);
    }
  }
  const shipNameOf = async (shipId: ShipId) => (await tx.ships.find(fleetId, shipId))?.name;
  const labels: FleetLabel[] = [];
  for (const label of found) {
    labels.push({ key: label.key, values: label.values.map((value) => value.value), definer: await definerNameOf(label.owner, shipNameOf) });
  }
  const ships = new Map<string, ShipId>();
  for (const name of ownerNamesIn(file.rules)) {
    const ship = await tx.ships.findActiveByName(fleetId, name);
    if (ship) {
      ships.set(name, ship.id);
    }
  }
  return { labels, found, activeShipNames: [...ships.keys()], ships };
}
