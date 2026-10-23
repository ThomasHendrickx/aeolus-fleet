import { ANY_LABEL_VALUE, SAME_LABEL_VALUE, isOwnerTerm, type LabelId, type LabelValueId, type ExportedNetworkRules, type ShipId } from '@aeolus-fleet/common';

import type { Caller } from '../shared/caller.js';
import type { Clock } from '../shared/clock.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';
import type { UnitOfWork } from '../shared/unit-of-work.js';
import type { LabelOwner } from './label.js';
import { exportedFile } from './network-rules-file.js';
import type { NetworkRule } from './network-settings.js';
import type { FleetRepository, LabelRepository, NetworkSettingsRepository, ShipRepository } from './ports.js';

export interface ExportNetworkRulesTx {
  fleets: Pick<FleetRepository, 'find'>;
  networkSettings: Pick<NetworkSettingsRepository, 'findForShare'>;
  labels: Pick<LabelRepository, 'listNamedBy'>;
  ships: Pick<ShipRepository, 'find'>;
}

export type ExportNetworkRules = (caller: Caller) => Promise<Result<ExportedNetworkRules, DomainError<'FLEET_NOT_FOUND'>>>;

/**
 * Use case: any actor holding fleet:network exports the fleet's applied
 * rules, never the draft, as the network rules file (design network-io,
 * section 4), with the rules it left out and why, checked before this runs. Read under the shared settings lock,
 * so the file holds one version; it changes nothing.
 */
export function createExportNetworkRules(deps: { uow: UnitOfWork<ExportNetworkRulesTx>; clock: Clock }): ExportNetworkRules {
  return (caller) =>
    deps.uow.run(async (tx): Promise<Result<ExportedNetworkRules, DomainError<'FLEET_NOT_FOUND'>>> => {
      const { fleetId } = caller;
      const fleet = await tx.fleets.find(fleetId);
      if (!fleet) {
        return refuse('FLEET_NOT_FOUND', `The installation hosts no fleet ${fleetId}`);
      }
      const settings = await tx.networkSettings.findForShare(fleetId);
      const rules = settings.rules ?? [];
      const labels = await tx.labels.listNamedBy(fleetId, { labelIds: labelIdsIn(rules), valueIds: valueIdsIn(rules) });
      const shipNames = new Map<ShipId, string>();
      const nameOf = async (shipId: ShipId) => {
        const name = shipNames.get(shipId) ?? (await tx.ships.find(fleetId, shipId))?.name;
        if (name !== undefined) {
          shipNames.set(shipId, name);
        }
        return name;
      };
      for (const shipId of ownerShipIdsIn(rules)) {
        await nameOf(shipId);
      }
      const definers: { label: (typeof labels)[number]; definer: string }[] = [];
      for (const label of labels) {
        definers.push({ label, definer: await definerNameOf(label.owner, nameOf) });
      }
      return ok(exportedFile({ fleet: { id: fleetId, name: fleet.name }, applied: settings, labels: definers, shipNames, at: deps.clock.now() }));
    });
}

/** A label's definer as the file names it: its ship's name, or `installation`. */
export async function definerNameOf(owner: LabelOwner, shipNameOf: (shipId: ShipId) => Promise<string | undefined>): Promise<string> {
  return owner.kind === 'installation' ? 'installation' : ((await shipNameOf(owner.shipId)) ?? owner.shipId);
}

function termsOf(rules: readonly NetworkRule[]) {
  return rules.flatMap((rule) => [...rule.from, ...rule.to]);
}

function valueIdsIn(rules: readonly NetworkRule[]): LabelValueId[] {
  return [...new Set(termsOf(rules).flatMap((term) => (typeof term === 'string' ? [term] : [])))];
}

function labelIdsIn(rules: readonly NetworkRule[]): LabelId[] {
  return [...new Set(termsOf(rules).flatMap((term) => (typeof term !== 'string' && !isOwnerTerm(term) ? [term.labelId] : [])))];
}

function ownerShipIdsIn(rules: readonly NetworkRule[]): ShipId[] {
  return [...new Set(termsOf(rules).flatMap((term) => (typeof term !== 'string' && isOwnerTerm(term) && term.owner !== ANY_LABEL_VALUE && term.owner !== SAME_LABEL_VALUE ? [term.owner] : [])))];
}
